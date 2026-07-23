/** Express uses Node's Connect middleware contract, so no second runtime is needed. */
export {
  createReqKeyMiddleware,
  createReqKeyMiddleware as reqkey,
  createReqKeyMiddleware as reqkeyMiddleware,
} from "./node.js";
export type {
  NodeMiddleware as ExpressReqKeyMiddleware,
  NodeMiddlewareOptions as ExpressReqKeyOptions,
  ReqKeyNodeRequest as ReqKeyExpressRequest,
} from "./node.js";
