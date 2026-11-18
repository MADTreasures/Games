# Crystal Drop

> **Vorlage:** eigenes Android-Projekt (Kotlin, OpenGL ES) · **Plattform:** Browser (eine HTML-Datei), später Android-APK · **Status:** 🟢 lauffähig

Fallblock-Puzzle mit Spielsteinen aus Cartoon-Bergkristall. Volle Reihen verschwinden nicht einfach:
sie bekommen Risse und zerspringen wie Glas. Gespielt wird in einer animierten Kristallhöhle, die
mit jedem Level wechselt.

## Stand

- [x] Spielregeln 1:1 aus der Vorlage portiert (`src/logic.js`), mit Tests gegen die Kotlin-Werte
- [x] Kristall-Look und Splitter-Effekt (`src/crystal.js`)
- [x] Animierte Höhle mit einem Thema pro Level (`src/cave.js`)
- [x] Startbildschirm mit gezeichnetem Logo, plastische Knöpfe
- [x] Sound komplett synthetisch über Web Audio (`src/audio.js`)
- [x] Touch- und Tastatursteuerung wie in der Vorlage
- [ ] APK-Version

## Schnellstart

```bash
node build.mjs                      # baut index.html (Cartoon-Look) aus src/
node build.mjs real                 # baut real.html (realistischer Look, src/skins/real/)
node --test tests/logic.test.mjs    # Regel-Tests
```

`index.html` oder `real.html` direkt im Browser öffnen – fertig. Es wird nichts nachgeladen.

## Zwei Looks, ein Spiel

| Datei | Look | Kristalle | Höhle | Oberfläche |
| ----- | ---- | --------- | ----- | ---------- |
| `index.html` | Cartoon | kräftige Konturen, flache Farbflächen | gezeichnete Höhle | bunte 3D-Knöpfe |
| `real.html` | Realistisch | durchscheinende Kristalle ohne Kontur | fotografische Höhlenräume mit Bewegung (Wasser, Licht, Staub) | Gestein, Bronze, Gravurschrift |

Regeln, Steuerung und Sound sind in beiden gleich. Ein Skin ist ein Ordner unter
`src/skins/<name>/`: `crystal.js` und `cave.js` ersetzen das Standardmodul, `skin.js` liefert Rahmen, Logo
und Texturen (`KF.Skin`), `style.css` wird an das Standard-Stylesheet angehängt.

Die Höhlenräume des realistischen Looks stammen aus der parallel entstandenen «Höhlenedition»
(Branch `crystal-drop/png-komplettpaket`): acht Raumbilder und ein Titelbild in `assets/caves/`, dazu die
Bewegungsmodule in `src/skins/real/cave.js`. `caves.json` ordnet Bild und Bildausschnitt den Leveln zu;
`build.mjs` bettet die Bilder ein, damit das Spiel eine einzige Datei bleibt (rund 5,5 MB).

## Steuerung

| Touch | Tastatur | Wirkung |
| ----- | -------- | ------- |
| neben das Feld tippen (halten = weiterlaufen) | ← → | bewegen |
| auf den Stein tippen · Drehpfeil | ↑ oder X | drehen |
| Pfeil unten (halten) | ↓ | langsam fallen |
| DROP | Leertaste | sofort fallen |
| PAUSE | P | Pause |
| Menü-Knopf | Esc | Menü |

## Aufbau

| Pfad | Inhalt |
| ---- | ------ |
| `index.html` | Fertiges Spiel, eine Datei (wird von `build.mjs` erzeugt) |
| `src/logic.js` | Spielregeln ohne DOM – Port von `Board.kt`, `Tetromino.kt`, `Randomizer.kt`, `GameState.kt` |
| `src/crystal.js` | Kristall-Zeichnung (vorgerenderte Sprites) und Splitter-Partikel |
| `src/cave.js` | Höhlen-Hintergrund: Themen pro Level, Animation, Überblendung |
| `src/audio.js` | Synthetische Soundeffekte |
| `src/game.js` | Layout, Rendering, Eingabe, HUD, Menü, Startbildschirm, Logo |
| `src/style.css`, `src/body.html` | Oberfläche |
| `assets/Fredoka-latin.woff2` | Schrift (SIL Open Font License 1.1), wird in die HTML-Datei eingebettet |
| `assets/Cinzel-latin.woff2` | Gravurschrift des realistischen Looks (SIL Open Font License 1.1) |
| `src/skins/real/` | Realistischer Look: Kristalle, Höhle, Rahmen, Logo, Gesteins-Texturen, Stylesheet |
| `assets/caves/` | Höhlenräume und Titelbild des realistischen Looks (WebP) |
| `tests/` | Regel-Tests (`node --test`) |
| `RESEARCH.md` | Was aus der Vorlage übernommen wurde und was bewusst anders ist |

Der Titel steht in `src/game.js` (`TITLE_LINES`), ein neues Höhlen-Thema ist ein weiterer Eintrag in
`THEMES` in `src/cave.js`.

## Rechtliches

- Eigener Code, eigene Grafik (alles zur Laufzeit gezeichnet), eigene Sounds (synthetisch).
- Der Name «Tetris» ist eine geschützte Marke und wird deshalb weder im Spiel noch im Paketnamen verwendet.
- Schrift «Fredoka»: © The Fredoka Project Authors, SIL Open Font License 1.1.
- Schrift «Cinzel»: © The Cinzel Project Authors, SIL Open Font License 1.1.
