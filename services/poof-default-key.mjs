import {createDecipheriv,createHash} from 'node:crypto';
// Obfuscation only: a public repository also contains the decryption material.
const encrypted='qM6CK4Wh7+L7nR+AOBj1Z6soh/YrYyeki7MaViQbXmhGBd8=';
const iv='uy0dcBLm5LHUQWrf';
const tag='KQp8aFF7MasVGE2vh4aMAg==';
export function builtInPoofKey(){const key=createHash('sha256').update('alsmanu6-poof-key-v1').digest();const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(encrypted,'base64')),cipher.final()]).toString('utf8')}
