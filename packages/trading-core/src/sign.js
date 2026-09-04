"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signKalshiRequest = signKalshiRequest;
exports.assertPemLooksValid = assertPemLooksValid;
const node_forge_1 = __importDefault(require("node-forge"));
/**
 * Kalshi RSA-PSS signature (SHA-256, salt length = digest = 32).
 * Pure JS (node-forge) so it runs both in Node.js Cloud Functions and Expo React Native.
 */
function signKalshiRequest(privateKeyPem, timestampMs, method, pathWithoutQuery) {
    const privateKey = node_forge_1.default.pki.privateKeyFromPem(privateKeyPem);
    const message = `${timestampMs}${method.toUpperCase()}${pathWithoutQuery}`;
    const md = node_forge_1.default.md.sha256.create();
    md.update(message, 'utf8');
    const pss = node_forge_1.default.pss.create({
        md: node_forge_1.default.md.sha256.create(),
        mgf: node_forge_1.default.mgf.mgf1.create(node_forge_1.default.md.sha256.create()),
        saltLength: 32,
    });
    const signature = privateKey.sign(md, pss);
    return node_forge_1.default.util.encode64(signature);
}
function assertPemLooksValid(pem) {
    if (!pem.includes('BEGIN') || !pem.includes('PRIVATE KEY')) {
        throw new Error('invalid_pem');
    }
    try {
        node_forge_1.default.pki.privateKeyFromPem(pem);
    }
    catch {
        throw new Error('invalid_pem');
    }
}
