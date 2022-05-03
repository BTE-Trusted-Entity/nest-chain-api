⚠️ Work In Progress ⚠️

# nest-chain-api

Manage a KILT blockchain connection in your nest.js application.

## Install

There is no release yet as it's WIP.

```bash
yarn add '@kiltprotocol/nest-chain-api@https://github.com/BTE-Trusted-Entity/nest-chain-api'
```

## Usage

Inside `your.module.ts`:

```ts
import { ChainApiModule } from '@kiltprotocol/nest-chain-api';

/**
 * One hour in milliseconds.
 */
const HOUR: number = 1000 * 60 * 60;

@Module({
  imports: [
    ChainApiModule.forRootAsync({
      imports: [],
      useFactory: async () => {
        return {
          chainWebsocket: "wss://spiritnet.kilt.io",
          // how long should the extrinsic status be stored?
          maxExtrinsicAge: HOUR,
        };
      },
      inject: [],
    }),
  ],
  controllers: [],
  providers: [],
})
export class YourModule {}
```

Inside `your.controller.ts`:

```ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Keyring } from '@polkadot/api';
import { KeyringPair } from '@polkadot/keyring/types';
import { cryptoWaitReady } from '@polkadot/util-crypto';

import { ConfigService } from 'src/config/config.service';
import { DidCall } from './interfaces/did-call.interface';
import { PromoStatus } from './interfaces/promo-status.interface';
import { ChainApiService } from '@kiltprotocol/nest-chain-api';

@Injectable()
export class DidPromoService {
  private readonly logger = new Logger(DidPromoService.name);
  private accountPair: KeyringPair | undefined;

  constructor(
     private readonly api: ChainApiService,
  ) {
    cryptoWaitReady().then(() => {
      const keyring: Keyring = new Keyring({
        ss58Format: 38,
        type: this.configService.getAccountKeyType(),
      });

      const accountSecret = this.configService.getAccountSecret();
      if (!accountSecret) {
        throw new Error('no faucet seed');
      }

      this.accountPair = keyring.addFromUri(accountSecret);
      this.logger.log(
        `Account that submits extrinsics: ${this.accountPair.address}`,
      );
      this.logger.log(
        `Account that execute did call: ${configService.getProxiedAccountAddress()}`,
      );
    });
  }

  public async waitFinalized(hash: string): Promise<boolean> {
    return this.api.waitFinalized(hash);
  }

  public async submitDidCall(
    callHex: string,
    signatureHex: string,
  ): Promise<DidCall> {
    const api = await this.api.getApi();

    // Try to build transaction and throw an error in case that fails
    let extrinsic;
    try {
      extrinsic = api.tx.proxy.proxy(
        this.configService.getProxiedAccountAddress(),
        null,
        api.tx.did.submitDidCall(callHex, signatureHex),
      );
    } catch (e) {
      this.logger.error(e);
      throw new BadRequestException(
        'INVALID_CALL',
        'Cannot submit DID call. The provided arguments where malformed.',
      );
    }

    // sign & submit
    const extrinsicHash = await this.api.sendExtrinsic(
      extrinsic,
      this.accountPair,
    );

    return {
      tx_hash: extrinsicHash,
    };
  }
}
```

## Disclaimer

This is still work in progress and not production ready.
PRs are very much appreciated.