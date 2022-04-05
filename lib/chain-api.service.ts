import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { SubmittableExtrinsic } from '@polkadot/api/types';
import { KeyringPair } from '@polkadot/keyring/types';
import { CONFIG_OPTIONS } from './constants';
import { ChainApiOptions, Health } from './interfaces';

/**
 * Handles a blockchain collection, submits transactions and keeps track of
 * account nonces.
 */
@Injectable()
export class ChainApiService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ChainApiService.name);
  private api: Promise<ApiPromise> | null;
  private pendingExtrinsics: { [key: string]: Promise<boolean> };
  private lastAccountNonce: { [key: string]: bigint };

  constructor(@Inject(CONFIG_OPTIONS) private options: ChainApiOptions) {
    this.api = null;
    this.pendingExtrinsics = {};
    this.lastAccountNonce = {};
  }

  /**
   * When the application starts we want to connect to the blockchain.
   */
  public onApplicationBootstrap() {
    this.connect();
  }

  /**
   * Reports the health of the ChainApi Service.
   * The chainApi Service is healthy when there is a connection to the blockchain
   * and the number of in-flight extrinsics is reasonable.
   *
   * @returns the health status of the chain api
   */
  public async health(): Promise<Health> {
    const api = await this.getApi();

    return {
      blockchainConnected: api.isConnected,
      inFlightExtrinsics: Object.keys(this.pendingExtrinsics).length,
      runtimeVersion: api.runtimeVersion.specVersion.toString(),
      runtimeName: api.runtimeVersion.specName.toString(),
      chainName: api.runtimeChain.toString(),
    };
  }

  /**
   * Returns the raw ApiPromise that can be used to communicate with the full
   * node. If there is no connection yet, the method will create a connection to
   * the configured full node.
   *
   * @returns The raw ApiPromise object that is the connection to the blockchain.
   */
  public async getApi(): Promise<ApiPromise> {
    if (typeof this.api === 'undefined' || this.api === null) {
      this.connect();
    }
    return await (this.api as Promise<ApiPromise>);
  }

  /**
   * Submit an extrinsic to the blockchain.
   *
   * This method will query the current nonce from chain and compares is to a
   * local nonce. In case the local nonce is higher than the nonce we received
   * from the full node, we assume that there are extrinsics in flight to the
   * full node and not yet registered by the full node. The local nonce is
   * therefore used and increased.
   *
   * An entry will be created, so that finalization can be tracked using the
   * `waitFinalized` method.
   *
   * @param extrinsic The extrinsic that will be submitted
   * @param sender The keypair of the account that submits the extrinsic
   * @returns The hash of the submitted extrinsic
   */
  public async sendExtrinsic(
    extrinsic: any,
    sender: KeyringPair,
  ): Promise<string> {
    const api = await this.getApi();

    let nonce = (
      await api.rpc.system.accountNextIndex(sender.address)
    ).toBigInt();
    const lastLocalNonce = this.lastAccountNonce[sender.address] || -1n;
    this.logger.log(
      `last local nonce ${lastLocalNonce}, current remote nonce ${nonce}`,
    );
    if (nonce <= lastLocalNonce) {
      nonce = lastLocalNonce + 1n;
    }
    this.lastAccountNonce[sender.address] = nonce;
    return await this.sendExtrinsicWithNonce(
      extrinsic,
      sender,
      this.lastAccountNonce[sender.address],
    );
  }

  /**
   * Wait for finalization of an extrinsic and report whether the extrinsic was
   * successful.
   *
   * @param extrinsicHash The hash of the extrinsic that we want to wait for
   * @returns Returns `true` if the extrinsic was successful, `false` otherwise.
   */
  public async waitFinalized(extrinsicHash: string): Promise<boolean> {
    const finalizationPromise = this.pendingExtrinsics[extrinsicHash];
    if (typeof finalizationPromise === 'undefined') {
      throw new NotFoundException(
        'UNKNOWN_EXTRINSIC',
        'The extrinsic was either already cleaned up or was never known to the service.',
      );
    }
    return await finalizationPromise;
  }

  /**
   * Checks whether the extrinsic events contain errors.
   *
   * The function will go through all event and check whether they are
   * `System.ExtrinsicFailed` events. In case a `Proxy.ProxyExecuted` event is
   * contained, the event that is contained in `ProxyExecuted` will be checked
   * for an error too.
   *
   * @param api The raw polkadot-js ApiPromise
   * @param events The events that the extrinsic generated
   * @returns `true` if the extrinsic was successful, `false` otherwise
   */
  private static verifyExtrinsicSuccess(
    api: ApiPromise,
    events: any[],
  ): boolean {
    return !events
      // find/filter for failed events
      .find(({ event }) => {
        if (api.events.system.ExtrinsicFailed.is(event)) {
          return true;
        } else if (api.events.proxy.ProxyExecuted.is(event)) {
          return (
            typeof event.data[0] !== 'undefined' &&
            (event.data[0] as any).isError
          );
        }
      });
  }

  /**
   * Connect to the configured web socket and set the `api` object.
   */
  private connect() {
    const chain_ws_address = this.options.chainWebsocket;
    const wsProvider = new WsProvider(chain_ws_address);
    this.api = ApiPromise.create({ provider: wsProvider });
    this.logger.log(`Connecting to ${chain_ws_address}`);
  }

  /**
   * Submits an extrinsic with the specified nonce.
   *
   * @param extrinsic the extrinsic to submit
   * @param sender the sender of the extrinsic
   * @param nonce the nonce that should be used for submitting
   * @returns the hash of the submitted extrinsic
   */
  private async sendExtrinsicWithNonce(
    extrinsic: SubmittableExtrinsic<'promise'>,
    sender: KeyringPair,
    nonce: bigint,
  ): Promise<string> {
    const api = await this.getApi();
    const signedExtrinsic = await extrinsic.signAsync(sender, { nonce });
    const extrinsicHash = signedExtrinsic.hash.toHex();
    if (typeof this.pendingExtrinsics[extrinsicHash] !== 'undefined') {
      this.logger.error(
        `tried to submit the same extrinsic twice: ${extrinsicHash}`,
      );
      return extrinsicHash;
    }

    // promise for finalization
    let resolveIsFinalized = (_result: boolean) => {};
    const isFinalized = new Promise<boolean>((r) => {
      resolveIsFinalized = r;
    });

    try {
      await signedExtrinsic.send(({ events = [], status }) => {
        this.logger.log(`Transaction ${extrinsicHash} is ${status.type}`);

        if (status.isFinalized) {
          resolveIsFinalized(
            ChainApiService.verifyExtrinsicSuccess(api, events),
          );
        } else if (status.isDropped) {
          resolveIsFinalized(false);
        } else if (status.isInvalid) {
          resolveIsFinalized(false);
        } else if (status.isRetracted) {
          resolveIsFinalized(false);
        }
      });
    } catch {
      throw new InternalServerErrorException(
        'SUBMIT_FAILED',
        'The extrinsic could not be executed because of an internal error',
      );
    }
    this.pendingExtrinsics[extrinsicHash] = isFinalized;
    this.logger.log(`submitted extrinsic with hash: ${extrinsicHash}`);

    return extrinsicHash;
  }
}
