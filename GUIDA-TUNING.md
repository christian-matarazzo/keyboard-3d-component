# Guida rapida — dove e come modificare luci, materiali e rotazione

Tutto ciò che riguarda l'aspetto del modello si regola **prima dal vivo, poi nel codice**:

1. Avvia il sito e aggiungi `?debug` all'indirizzo → `http://localhost:5173/?debug`
2. In alto a destra compare un pannello con slider e color picker: muovili finché il risultato ti piace.
3. Ricopia i valori trovati nel codice, nei punti indicati sotto (i default nel codice **sono** i valori di produzione: il pannello parte sempre da lì).

Senza `?debug` il pannello non esiste e l'utente vede solo il modello.

---

## Luci (il "set fotografico")

**File: `src/components/KeyboardComposer/LightRig.jsx`**

Le 4 luci dello studio, ognuna con i suoi valori dentro `useControls(...)`:

| Cartella nel pannello | Cosa fa | Valori da ricopiare |
|---|---|---|
| `Luci · principale` | Il faro dall'alto, l'unico che proietta ombre | `intensity`, `position` (x, y, z), `angle`, `penumbra` |
| `Luci · fill laterali` | Due luci morbide ai lati (tenute basse: il contrasto è voluto) | `leftIntensity`, `leftColor`, `rightIntensity`, `rightColor` |
| `Luci · rim (retro)` | Luce da dietro: stacca la silhouette dal nero | `intensity`, `position`, `color` |
| `Luci · frontale` | Point light debole vicino camera: riempie le pose inclinate senza appiattire il contrasto | `intensity`, `color` |

**File: `src/components/KeyboardComposer/KeyboardModel.jsx`** — cartella `Luci · orbitale (sotto)`. Questa è la luce che risolve davvero il "buio quando si inclina": a differenza di tutte le altre (che seguono la camera e restano ferme nello spazio), questa è agganciata al GRUPPO CHE RUOTA col modello — quindi orbita insieme all'oggetto e resta sempre nella stessa posizione sotto la tastiera, qualunque sia la posa raggiunta. È quella che salva le viste di retro/sottoscocca e i tagli laterali estremi. `intensity`, `color`.

Le luci sono "solidali alla camera": non serve spostarle quando il modello ruota.

**File: `src/components/KeyboardComposer/Scene.jsx`** — cartella `Luci · ambiente` (il cuore del look cinematico):
- `strip top`: la strip light lunga e sottile sopra il modello — è LEI che crea le bande speculari che spazzolano i tasti durante la rotazione (il tratto distintivo degli shooting Apple).
- `strip bordo`: seconda strip fredda da dietro-sinistra, accende i glint sui bordi.
- `base diffusa`: cupola debolissima che tiene leggibili i neri. Alzarla = look più piatto e "cheap"; il contrasto è la cifra cinematografica.

## Materiali (effetto "bruciatura" sulle mesh)

**File: `src/components/KeyboardComposer/materials/registry.js`**

Ogni finitura definisce 3 slot (`keycaps`, `body`, `damping`) con 4 parametri:

- `roughness` (0–1): quanto è ruvida la superficie. **Più basso = riflessi più duri = rischio bruciatura.** Il body sta bene tra 0.45 e 0.55.
- `metalness` (0–1): quanto è metallico. Sopra 0.8 il materiale riflette in modo esponenziale la luce → è la causa principale delle bruciature. Tenere il body a ~0.6–0.7.
- `envMapIntensity` (0–2): quanto l'ambiente si riflette sul materiale. 1 = pieno, 0.5 = metà. È il "volume" dei riflessi (e delle bande delle strip).
- `clearcoat` (0–1) + `clearcoatRoughness` (0–1): lo strato "vetroso" sopra il materiale — è ciò che rende premium i keycaps (glint nitidi sui bordi). clearcoat alto + clearcoatRoughness bassa = vetro; abbassare il primo o alzare la seconda per un effetto più satinato.
- `color`: il colore base (hex).

Nel pannello `?debug` le cartelle `Materiale · body` e `Materiale · keycaps` cambiano questi valori in tempo reale sulla finitura attiva.

## Esposizione generale

**File: `src/components/KeyboardComposer/Scene.jsx`** — cartella `Resa`, slider `exposure` (default `1.0`). È la "manopola generale" della luminosità: se tutto brucia, prima di toccare le luci prova ad abbassare questa. Il valore va ricopiato in due punti di Scene.jsx: il default dentro `ExposureTuner` e `toneMappingExposure` nelle opzioni del `<Canvas>`.

## Ombra sotto la tastiera

Cartella `Ombra a contatto` (`opacity`, `blur`) → default in `Scene.jsx`, componente `<ContactShadows>`.

## Rotazione, inquadratura e feeling del drag

**File: `src/components/KeyboardComposer/useComposerControls.js`** — cartella `Rotazione`:

- `velocità drag` (`dragSpeed`): quanto ruota per pixel trascinato. Più basso = più lento e "pesante".
- `inerzia in drag` (`followTime`): quanto il modello "insegue" il dito in ritardo. Più alto = più pastoso, stile Apple.
- `settle rilascio` (`settleTime`): morbidezza dell'assestamento sulla posa al rilascio.
- `soglia step` (`commitFraction`): frazione dei 45° oltre cui scatta la posa. Default **0.5** (posa più vicina): oltre metà strada scatta, sotto torna indietro. Abbassalo per far scattare anche drag più piccoli.
- `margine inquadratura` (`fitMargin`): quanto la camera arretra rispetto al fit esatto. Più alto = modello più piccolo nel frame.
- `zoom-out mobile` (`zoomOutMobile`): arretramento extra solo su schermi verticali.

Nello stesso file, fuori dal pannello:
- **focale** (`focalLength`, default 200): l'effetto tele "commercial". Più bassa = più prospettiva.
- **posa d'ingresso** (`initialRotation`, in `KeyboardModel.jsx`): 80° su desktop, **90°** su mobile portrait (non 0° — vedi nota sotto).

**Attenzione al roll mobile**: il roll che mette la tastiera in verticale (in `KeyboardModel.jsx`) ruota attorno all'asse Z del MONDO, non all'asse di vista della camera — quindi NON equivale a "ruotare la stessa immagine di 90° in-plane". Pose diverse rispondono al roll in modo diverso: pitch=0° rollato dà un taglio di profilo illeggibile, pitch=90° (vista dall'alto) rollato dà lo shot verticale corretto (righe di tasti orizzontali, manopole in alto — il riferimento del cliente). Se in futuro cambia la posa mobile, verificarla SEMPRE con uno screenshot reale, non per deduzione geometrica.

Le **regole** della rotazione sono logica, non parametri, e vivono in `useComposerControls.js`:
- **drag omnidirezionale con soft cap**: durante il gesto il modello segue il dito su entrambi gli assi (pitch sempre, yaw solo dalla posa orizzontale), ciascuno clampato a ±45° dalla posa di partenza (mai rotazione libera);
- **al rilascio, snap alla posa più vicina (50%)** committando UN SOLO asse — quello con lo spostamento maggiore (l'altro torna alla partenza); sotto soglia su entrambi → nessun cambio;
- il ring laterale (yaw) si sblocca solo nella posa orizzontale (0°), ma da lì prosegue a step di 45° fino al giro completo (poi si rinormalizza);
- il giro verticale completo riatterra sulla posa hero d'ingresso (80°).

**Mobile**: la tastiera è rollata in verticale in `KeyboardModel.jsx` (wrapper con `rotation.z`), ma la mappatura del gesto NON è scambiata: swipe verticale = pitch (flusso principale), orizzontale = yaw. Load = vista dall'alto (pitch 90°, `initialRotation` condizionale in `KeyboardModel.jsx`). Tumblando fino alla posa orizzontale (pitch 0) si vede il profilo del case (vista sottile/verticale — beauty shot dello stack, non un bug).

## Regole d'oro anti-bruciatura

1. Mai `metalness > 0.8` insieme a `roughness < 0.4`.
2. Se un riflesso brucia solo su certe pose, abbassa `envMapIntensity` del materiale, non l'intensità delle luci.
3. Ruota il modello su tutte le pose (soprattutto retro e sotto) prima di dare l'ok a un valore.
4. Una luce direzionale non salva una faccia il cui normale guarda altrove: per riempire "a prescindere dall'orientamento" serve un point light (`Luci · frontale`) o alzare `base diffusa`, non un'altra direzionale.
5. Se il buio persiste su TUTTE le pose ruotate (retro, tagli laterali) nonostante luci frontali/ambientali, il problema è che quelle luci sono ferme rispetto alla camera: serve una luce agganciata al gruppo che ruota col modello (vedi `Luci · orbitale (sotto)` sopra), che orbita insieme all'oggetto invece di restare fissa nello spazio.
