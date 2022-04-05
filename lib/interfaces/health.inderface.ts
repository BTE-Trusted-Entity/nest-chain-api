/**
 * The health of the chain api module.
 *
 * @publicApi
 */
export interface Health {
  /**
   * Indicates if the service is connected to the blockchain.
   */
  blockchainConnected: boolean;
  /**
   * The number of extrinsics that are in-flight and tracked by the service.
   * A high number might indicate a memory issue.
   */
  inFlightExtrinsics: number;
  /**
   * The runtime version of the connected blockchain
   */
  runtimeVersion: string;
  /**
   * The runtime name of the connected blockchain.
   */
  runtimeName: string;
  /**
   * The name of the connected blockchain.
   */
  chainName: string;
}
