# Guida rapida — dove e come modificare luci, materiali e rotazione

Tutto ciò che riguarda l'aspetto del modello si regola **prima dal vivo, poi nel codice**:

1. Avvia il sito e aggiungi `?debug` all'indirizzo → `http://localhost:5173/?debug`
2. In alto a destra compare un pannello con slider e color picker: muovili finché il risultato ti piace.
3. Ricopia i valori trovati nel codice, nei punti indicati sotto (i default nel codice **sono** i valori di produzione: il pannello parte sempre da lì).

Senza `?debug` il pannello non esiste e l'utente vede solo il modello.

---

## Luci (il "set fotografico")

**File: `src/components/KeyboardComposer/LightRig.jsx`** 


Impianto DIAGONALE (round 8, sketch cliente): una sorgente dominante da
alto-sinistra + un fill dall'angolo opposto basso-destra. La diagonale
key→fill è ciò che crea il gradiente (la FORMA) su OGNI posa — il set
simmetrico precedente (due key in alto) lavava le pose inclinate rendendole
piatte (il 45 laterale su tutte). Le luci dirette:

| Cartella nel pannello | Cosa fa | Valori da ricopiare |
|---|---|---|
| `Luci · key principale (alto-sx)` | Spot dominante da alto-sinistra, radente: rastrella di taglio la faccia visibile e fa "rotolare" la luce sui keycaps (genera la forma). Unico shadow caster | `intensity`, `position` (x, y, z), `angle`, `penumbra` |
| `Luci · fill (basso-dx)` | Spot debole dall'angolo opposto basso-destra: solleva il lato in ombra senza pareggiare il gradiente | `intensity`, `position`, `angle`, `penumbra` |
| `Luci · rake laterale` | Luce radente quasi orizzontale dal lato: spazzola le facce rivolte alla camera nelle elevazioni a pitch 0 (front/back/laterali), dove la key colpisce solo i top e le facce frontali resterebbero al buio. Rivela il rilievo come filo di luce sui bordi — NON è un fill frontale (round 9) | `intensity`, `position`, `color`, `angle`, `penumbra` |
| `Luci · rim (profondità)` | Kicker da dietro-alto: accende il bordo lontano della sagoma così il prodotto si stacca dal fondo nero. È il principale segnale di PROFONDITÀ su set nero (round 9) | `intensity`, `position`, `color`, `angle`, `penumbra` |

> **Niente point light frontale** (rimosso al round 8): riempiva ogni faccia
> in modo uniforme e appiattiva le pose inclinate. Il dettaglio delle facce
> frontali nelle elevazioni a pitch 0 lo dà il `rake laterale` (radente = fa
> forma), NON un frontale (che spiana). Se una elevazione resta scura, alza
> il rake o la `base diffusa`, mai un frontale.
>
> **Profondità premium**: la separazione dal nero la fa il `rim`. È radente e
> contenuto: verifica che non bruci il bordo del case sulla laterale pura
> (yaw 90°, pitch 0°) e sulla Top (90°, 0°).

**File: `src/components/KeyboardComposer/KeyboardModel.jsx`** — cartella `Luci · orbitale (sotto)`. Questa è la luce che risolve davvero il "buio quando si inclina": a differenza di tutte le altre (che seguono la camera e restano ferme nello spazio), questa è agganciata al GRUPPO CHE RUOTA col modello — quindi orbita insieme all'oggetto e resta sempre nella stessa posizione sotto la tastiera, qualunque sia la posa raggiunta. È quella che salva le viste di retro/sottoscocca e i tagli laterali estremi. `intensity`, `color`.

Le luci sono "solidali alla camera": non serve spostarle quando il modello ruota.

**File: `src/components/KeyboardComposer/Scene.jsx`** — cartella `Luci · ambiente`: le strip Lightformer sono il "filo di luce" speculare che, nello sketch round 8, deve AVVOLGERE il prodotto in un tratto continuo (top → angolo alto-destra → lato destro → basso-destra). Sono posizionate per congiungersi agli angoli, senza stacco:
- `strip top`: lungo il bordo superiore, tutta la larghezza; il suo estremo destro raggiunge l'angolo alto-destra.
- `strip destra`: verticale, parte dall'angolo alto-destra (si salda alla top) e scende su tutto il lato destro.
- `strip basso-dx`: corta, all'angolo in basso a destra — chiude il filo incontrando la coda della strip destra (è la seconda sorgente dello sketch).
- `strip sinistra (tenue)`: presenza minima, solo perché il bordo sinistro non sprofondi nel nero — a sinistra la forma la fa la KEY diretta, non un bordo speculare acceso.
- `base diffusa`: cupola debolissima che tiene leggibili i neri. Alzarla = look più piatto e "cheap"; il falloff scuro è la cifra premium.

> **Se una posa va piatta** (tipo il 45 laterale): NON alzare la base diffusa né aggiungere un frontale. Il piatto viene da luci troppo simmetriche/frontali: serve accentuare la diagonale (key alto-sx più radente, fill basso-dx). Un filo di `clearcoat` sui keycaps (finitura `grafite` in `registry.js`, ~0.5) aiuta il materiale a "risaltare" mostrando il rake — verificare sempre Top e laterale pura per non far ribruciare il case.

> **Rake su layer dedicato (round 10)**: il `rake laterale` illumina SOLO i keycaps, non il case. Motivo: radendo l'alluminio delle piastre generava una spazzolata speculare bianca (bruciatura) sulle elevazioni. Meccanismo three.js `layers`: la costante `RAKE_LAYER` (esportata da `LightRig.jsx`) è settata sulla luce (`rake.layers.set`) e abilitata sulle sole mesh keycaps in `KeyboardModel.jsx` (`mesh.layers.enable`). Se aggiungi keycaps o cambi lo slot, ricontrolla che il layer sia abilitato lì. Per far "vedere" il rake anche al case NON togliere il layer: alza semmai la roughness del body così non brucia.

## Materiali (effetto "bruciatura" sulle mesh)

**File: `src/components/KeyboardComposer/materials/registry.js`**

Ogni finitura definisce 3 slot (`keycaps`, `body`, `damping`) con 4 parametri:

- `roughness` (0–1): quanto è ruvida la superficie. **Più basso = riflessi più duri = rischio bruciatura.** Il body (alluminio anodizzato) va tenuto SATINATO, ~0.6: sotto 0.5 le piastre prendono speculari duri a incidenza radente e bruciano sulle elevazioni. I solchi delle piastre restano leggibili col diffuso (lo specular anzi li nasconde), quindi alzare la roughness NON toglie dettaglio.
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
- `soglia step` (`commitFraction`): frazione della distanza verso la posa adiacente oltre cui scatta. Default **0.5** (posa più vicina): oltre metà strada scatta, sotto torna indietro.
- `molla rigidità` (`springStiffness`) e `molla smorzamento` (`springDamping`): il carattere del BOUNCE al rilascio. Smorzamento < 1 = sotto-smorzato: un gesto più forte del necessario atterra sulla posa con overshoot e ritorno elastico proporzionale all'energia; a 1+ il bounce sparisce. Rigidità = velocità dell'assestamento.
- `elastico oltre-step` (`rubberFactor`) e `elastico max (°)` (`rubberCapDeg`): quanto il modello "cede" oltre la posa adiacente (o oltre l'ultimo stop dell'arco) durante il drag. È la resistenza che si sente tirando troppo, e l'energia che alimenta il bounce.
- `margine inquadratura` (`fitMargin`): quanto la camera arretra rispetto al fit esatto. Più alto = modello più piccolo nel frame.
- `zoom-out mobile` (`zoomOutMobile`): arretramento extra solo su schermi verticali.

Nello stesso file, fuori dal pannello:
- **focale** (`focalLength`, default 200): l'effetto tele "commercial". Più bassa = più prospettiva.
- **camera livellata**: la camera sta alla quota del pivot (`PIVOT_Y`) e guarda in orizzontale — le viste front/left/right del cliente hanno elevazione zero; ogni inclinazione viene dal pitch del modello. Non rialzarla: sfaserebbe TUTTE le pose rispetto ai riferimenti.

## Le pose (contratto col cliente)

**File: `src/components/KeyboardComposer/poseGraph.js`** — ogni posa raggiungibile è 1:1 con i riferimenti del cliente (i JPEG in `rig set/` + le due aggiunte a voce del round 7: `back` e `alto laterale`). Stop del ViewCube di Maya: facce 0°/90°, spigoli 45°, corner a 35.264°. La tabella `POSES` è nominata come i file del cliente: se un confronto visivo rivelasse uno scarto, si ritocca lì.

Le **regole** della rotazione (logica, non parametri):
- **ogni step è una rotazione SEMPLICE di 45° sul proprio asse** — mai flip/spin composti (round 7: lo spin verso la vista da dietro è stato respinto, "ogni rotazione deve avere i suoi 45 gradi");
- **drag omnidirezionale con soft cap**: durante il gesto il modello segue il dito sugli assi dove il grafo ha stop (yaw solo dalla posa orizzontale), fino allo stop adiacente + coda elastica;
- **al rilascio, snap se oltre soglia** committando UN SOLO asse — quello col progresso maggiore (l'altro torna alla partenza): le pose diagonali fuori dal set non esistono;
- gli archi sono **clampati**: verticale da `bottom` (−90°) a `3-4 back` (135°), laterale da `back` sx (−180°) a `back` dx (+180°). Oltre l'ultimo stop c'è solo elastico + bounce di ritorno;
- i **corner** (`initial position`, `3-4 front right`) si raggiungono da `3-4 left`/`3-4 right` (yaw ±45°) con un mini-step verticale di 35.264°; le **viste `alto laterale`** da `left`/`right` (yaw ±90°) con uno step di 45°;
- **posa d'ingresso** (`initialRotation` in `KeyboardModel.jsx`): desktop = corner `initial position` (35.264°, +45°); mobile portrait = vista top verticale (pitch 90° + yaw 90°, manopole in alto).

**Mobile**: niente roll esterno — la posa verticale è pitch 90° + yaw 90° e l'arco verticale vive anche sull'asse yaw 90° (solo in portrait). La mappatura del gesto è identica al desktop: swipe verticale = flusso principale, orizzontale = yaw dalla posa orizzontale.

## Regole d'oro anti-bruciatura

1. Mai `metalness > 0.8` insieme a `roughness < 0.4`.
2. Se un riflesso brucia solo su certe pose, abbassa `envMapIntensity` del materiale, non l'intensità delle luci.
3. Ruota il modello su tutte le pose (soprattutto retro e sotto) prima di dare l'ok a un valore.
4. Una luce direzionale non salva una faccia il cui normale guarda altrove: per riempire "a prescindere dall'orientamento" serve un point light (`Luci · frontale`) o alzare `base diffusa`, non un'altra direzionale.
5. Se il buio persiste su TUTTE le pose ruotate (retro, tagli laterali) nonostante luci frontali/ambientali, il problema è che quelle luci sono ferme rispetto alla camera: serve una luce agganciata al gruppo che ruota col modello (vedi `Luci · orbitale (sotto)` sopra), che orbita insieme all'oggetto invece di restare fissa nello spazio.
6. **Case che brucia nelle viste laterali/top (round 7)**: la scocca in alluminio prende una spazzolata speculare bianca quando gli spot chiave (`Luci · key sx/dx`) e le strip la colpiscono di taglio. Il fix NON è alzare l'esposizione o l'ambiente: è tenere gli spot chiave moderati (sx ~14, dx ~8) e le strip contenute (sinistra ~7, top ~5, destra ~3.5), lasciando che la `base diffusa` (~0.55) sollevi i neri. Verificare SEMPRE la vista laterale pura (yaw 90°, pitch 0°) e la Top (90°, 0°): sono quelle dove il case brucia per primo.
