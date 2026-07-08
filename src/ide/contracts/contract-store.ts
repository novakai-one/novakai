/* =====================================================================
   contract-store.ts — K4 Contracts tab: dev file-bridge client
   ---------------------------------------------------------------------
   IO only, same style as src/io/files.ts's design-bridge client: relative
   fetch paths, try/catch swallows a bridge-absent failure. FROZEN bridge
   API (vite-file-bridge.mjs, built in parallel to this exact contract):
     GET  /novakai/contracts        -> {"v":1,"contracts":[...]}
     POST /novakai/contracts/write  body {"record": <ContractRecord>} -> {"ok":true} | 400

   loadRecords() returns null (never []) when the fetch itself fails or
   the response isn't ok — that null is the ONLY signal contracts.ts uses
   to know the bridge is up; an empty array must never be inferred as
   "bridge absent" or vice versa.
   ===================================================================== */

import { isRecord, type ContractRecord } from './contract-record';

interface ContractsIndexResponse { v: number; contracts: unknown[] }

export async function loadRecords(): Promise<ContractRecord[] | null> {
  try {
    const res = await fetch('/novakai/contracts');
    if (!res.ok) return null;
    const body = (await res.json()) as ContractsIndexResponse;
    return Array.isArray(body.contracts) ? body.contracts.filter(isRecord) : [];
  } catch {
    return null;
  }
}

export async function saveRecord(record: ContractRecord): Promise<boolean> {
  try {
    const res = await fetch('/novakai/contracts/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
