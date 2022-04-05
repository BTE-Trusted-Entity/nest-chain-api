import { ModuleMetadata } from '@nestjs/common';

export interface ChainApiOptions {
  chainWebsocket: string;
}

export interface ChainApiOptionsFactory {
  createHttpOptions(): Promise<ChainApiOptions> | ChainApiOptions;
}

export interface ChainApiAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: any[]) => Promise<ChainApiOptions> | ChainApiOptions;
  inject: any[];
}
