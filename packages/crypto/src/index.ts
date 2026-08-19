export { canonicalEncode, type JsonValue } from "./canonical.js";
export {
  generateIdentity,
  saveIdentity,
  loadIdentity,
  publicKeyFromHex,
  privateKeyFromHex,
} from "./identity.js";
export {
  signMutation,
  verifyMutation,
  signCredential,
  verifyCredential,
  type SignableMutationFields,
  type SignableCredentialFields,
} from "./signatures.js";
