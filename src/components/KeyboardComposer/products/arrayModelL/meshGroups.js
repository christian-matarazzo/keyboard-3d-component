/**
 * Gruppi logici di mesh di ARRAY_MODEL_L — DATI, non macchina: la
 * classificazione generica (`collectMeshGroups`) sta in
 * `materials/meshGroups.js` e non conosce nessuno di questi nomi.
 *
 * Classificazione PURAMENTE per nome nodo (nameTokens, substring match): non
 * per nome materiale. Più gruppi possono condividere lo stesso materiale
 * Maya (es. body/rotors/tasselli condividono standardSurface3SG in questo
 * asset) ed erano comunque disambiguati solo dal nome nodo, quindi il doppio
 * binario materiale+nodo era macchinario in più per un problema che il solo
 * nameTokens risolve già direttamente — ed elimina la classe di bug per cui
 * un nome materiale "vince" ignorando un nameTokens più specifico (una mesh
 * chiamata "..._Tasselli_..." finiva silenziosamente in `damping` perché
 * condivideva il materiale di damping, standardSurface2SG, nonostante il
 * nome nodo indicasse chiaramente `tasselli`).
 *
 * ⚠️ Gli `id` sono un CONTRATTO con il file di configurazione del prodotto:
 * sono le chiavi delle sezioni `materials` e `focus` di
 * `public/lightconfig/app-state-config.json` e i `groupId` dei selettori nelle
 * animazioni autorate. Rinominarne uno invalida silenziosamente quella parte
 * del JSON (i valori cadono sui default). Vedi `products/productSchema.js`.
 */

/**
 * ⚠️ L'ORDINE DI QUESTO ARRAY È SIGNIFICATIVO: `collectMeshGroups` usa
 * `groups.find(...)`, quindi vince il PRIMO gruppo che matcha. È l'ordine, non
 * i token, il modo previsto per disambiguare i casi in cui più regole
 * potrebbero rivendicare la stessa mesh.
 *
 * Due dipendenze concrete da questo ordine:
 *  - `patchesISO`/`patchesANSI` PRIMA di `body`: le mesh delle varianti si
 *    chiamano `…S05_L_ISO…`, quindi il token `S0` di `body` le rivendicherebbe
 *    per primo e i patch non avrebbero mai un gruppo proprio.
 *  - `damping` prima di `landing`: `Damping_Foots_Rialzo` contiene entrambi i
 *    token e appartiene al damping.
 *
 * ⚠️ I token vanno confrontati con i nomi che GLTFLoader produce A RUNTIME, non
 * con quelli del file: il loader sostituisce gli spazi con underscore e
 * aggiunge suffissi di deduplica (`L_ARRAY S05_L_ISO` → `L_ARRAY_S05_L_ISO_1`).
 * Token come `S01_1` sembrano plausibili leggendo il GLB ma non matchano nulla
 * a runtime, dove i nomi sono `L_ARRAY_S01`; le mesh finirebbero nel gruppo
 * giusto solo per via del fallback, cioè per caso.
 *
 * `fallback: true` su `body` = bucket delle mesh che non matchano nulla (vedi
 * `collectMeshGroups`). Va dichiarato qui e non passato come parametro: è un
 * fatto di QUESTO modello, non della funzione che classifica.
 *
 * @type {import('../../materials/meshGroups').MeshGroup[]}
 */
export const ARRAY_MODEL_L_MESH_GROUPS = [
  { id: 'keycaps', label: 'Keycaps', nameTokens: ['Keycaps'] },
  { id: 'patchesISO', label: 'PatchSystemISO', nameTokens: ['ISO'] },
  { id: 'patchesANSI', label: 'PatchSystemANSI', nameTokens: ['ANSI'] },
  { id: 'body', label: 'Body', nameTokens: ['S0'], fallback: true },
  { id: 'damping', label: 'Damping', nameTokens: ['Damping'] },
  { id: 'rotors', label: 'Rotors', nameTokens: ['Rotor'] },
  { id: 'tasselli', label: 'Tasselli', nameTokens: ['Tasselli'] },
  { id: 'landing', label: 'Rialzo', nameTokens: ['Rialzo'] },
  { id: 'viti', label: 'Viti', nameTokens: ['M3_'] },
]
