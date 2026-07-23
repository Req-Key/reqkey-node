import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Inject,
  Injectable,
  Module,
  RequestMethod,
  createParamDecorator,
  type DynamicModule,
  type ExecutionContext,
  type FactoryProvider,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestMiddleware,
  type NestModule,
} from "@nestjs/common";
import type { ReqKeyError } from "./errors.js";
import {
  createReqKeyMiddleware,
  type NodeMiddleware,
  type NodeMiddlewareOptions,
  type NodeNext,
  type ReqKeyNodeRequest,
} from "./node.js";
import type { VerificationResult } from "./types.js";

export const REQKEY_NEST_OPTIONS = Symbol("REQKEY_NEST_OPTIONS");

export type NestReqKeyRequest = IncomingMessage & ReqKeyNodeRequest;
export type NestReqKeyOptions = NodeMiddlewareOptions<NestReqKeyRequest>;

export interface NestReqKeyModuleAsyncOptions<
  TDependencies extends readonly unknown[] = readonly unknown[],
> {
  imports?: ModuleMetadata["imports"];
  inject?: FactoryProvider["inject"];
  useFactory: (...dependencies: TDependencies) =>
    | NestReqKeyOptions
    | Promise<NestReqKeyOptions>;
}

/** Nest-compatible functional middleware for bootstrap-level registration. */
export function reqkeyNest(options: NestReqKeyOptions): NodeMiddleware<NestReqKeyRequest> {
  return createReqKeyMiddleware(options);
}

@Injectable()
export class ReqKeyNestMiddleware implements NestMiddleware {
  readonly #middleware: NodeMiddleware<NestReqKeyRequest>;

  constructor(
    @Inject(REQKEY_NEST_OPTIONS)
    options: NestReqKeyOptions,
  ) {
    this.#middleware = createReqKeyMiddleware(options);
  }

  use(
    request: NestReqKeyRequest,
    response: ServerResponse,
    next: NodeNext,
  ): Promise<void> {
    return this.#middleware(request, response, next);
  }
}

@Module({})
export class ReqKeyModule implements NestModule {
  static forRoot(options: NestReqKeyOptions): DynamicModule {
    return {
      module: ReqKeyModule,
      providers: [
        { provide: REQKEY_NEST_OPTIONS, useValue: options },
        ReqKeyNestMiddleware,
      ],
      exports: [REQKEY_NEST_OPTIONS],
    };
  }

  static forRootAsync<TDependencies extends readonly unknown[]>(
    options: NestReqKeyModuleAsyncOptions<TDependencies>,
  ): DynamicModule {
    return {
      module: ReqKeyModule,
      ...(options.imports === undefined ? {} : { imports: options.imports }),
      providers: [
        {
          provide: REQKEY_NEST_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        ReqKeyNestMiddleware,
      ],
      exports: [REQKEY_NEST_OPTIONS],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(ReqKeyNestMiddleware)
      .forRoutes({ path: "{*splat}", method: RequestMethod.ALL });
  }
}

/** Inject the successful ReqKey validation decision into a controller argument. */
export const ReqKeyDecision = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerificationResult | undefined =>
    nestRequest(context).reqkey,
);

/** Inject the validation request ID into a controller argument. */
export const ReqKeyRequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    nestRequest(context).reqkeyRequestId,
);

/** Inject the ReqKey service error when fail-open behavior allowed the request. */
export const ReqKeyFailure = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ReqKeyError | undefined =>
    nestRequest(context).reqkeyError,
);

export const reqkey = reqkeyNest;
export default ReqKeyModule;

function nestRequest(context: ExecutionContext): ReqKeyNodeRequest {
  const request = context
    .switchToHttp()
    .getRequest<ReqKeyNodeRequest & { raw?: ReqKeyNodeRequest }>();
  return request.reqkey !== undefined || request.raw === undefined ? request : request.raw;
}
