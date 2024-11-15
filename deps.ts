// This file is needed for jsr to include dependencies properly
import "npm:webrtc-adapter@9.0.1";
import "npm:@protobuf-ts/runtime@2.9.4";
export type {
  RpcOptions,
  RpcTransport,
  UnaryCall,
} from "npm:@protobuf-ts/runtime-rpc@2.9.4";
export { RpcError } from "npm:@protobuf-ts/runtime-rpc@2.9.4";
export {
  TwirpErrorCode,
  TwirpFetchTransport,
} from "npm:@protobuf-ts/twirp-transport@2.9.4";
