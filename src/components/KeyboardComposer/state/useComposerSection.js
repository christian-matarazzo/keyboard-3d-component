import { useCallback, useSyncExternalStore } from 'react'

/**
 * Lettura REATTIVA di una sezione dello store: il componente si ri-renderizza
 * quando quella sezione cambia, e solo quella.
 *
 * Il gemello non reattivo è `store.get(section)`, ed è quello che si usa dentro
 * `useFrame`: leggere per-frame attraverso React significherebbe un render al
 * frame. I due convivono sullo stesso oggetto proprio perché il configuratore
 * ha bisogno di entrambe le letture — gli slider di un pannello vogliono il
 * render, la molla della camera vuole il valore e basta.
 *
 * ⚠️ Regge su `useSyncExternalStore`, che confronta gli snapshot per IDENTITÀ:
 * funziona solo perché `composerStore.set` restituisce lo stesso oggetto quando
 * nessun valore cambia davvero. Se un giorno quella garanzia salta, questo hook
 * entra in un ciclo di render infinito — ed è il motivo per cui sta scritta là.
 */
export function useComposerSection(store, section) {
  const subscribe = useCallback((onChange) => store.subscribe(section, onChange), [store, section])
  const getSnapshot = useCallback(() => store.get(section), [store, section])
  // Lo stesso snapshot lato server: lo stato iniziale è già completo (vedi
  // createInitialState), quindi non c'è nulla da idratare diversamente.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
