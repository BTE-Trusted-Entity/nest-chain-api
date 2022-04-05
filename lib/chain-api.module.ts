import { DynamicModule, Module } from '@nestjs/common';
import { ChainApiService } from './chain-api.service';
import { ChainApiAsyncOptions, ChainApiOptions } from './interfaces';
import { CONFIG_OPTIONS as CHAIN_API_OPTIONS } from './constants';

/**
 * The ChainApi module integrates a blockchain connection to any polkadot-js
 * compatible blockchain into your Nest application.
 *
 * @publicApi
 */
@Module({})
export class ChainApiModule {
  static forRoot(options: ChainApiOptions): DynamicModule {
    return {
      global: true,
      module: ChainApiModule,
      providers: [
        {
          provide: CHAIN_API_OPTIONS,
          useValue: options,
        },
        ChainApiService,
      ],
      exports: [ChainApiService],
    };
  }

  static forRootAsync(options: ChainApiAsyncOptions): DynamicModule {
    return {
      module: ChainApiModule,
      imports: options.imports,
      providers: [
        {
          provide: CHAIN_API_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        ChainApiService,
      ],
      exports: [ChainApiService],
    };
  }
}
