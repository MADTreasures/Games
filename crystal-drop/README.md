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
node build.mjs                      # baut index.html aus src/
node --test tests/logic.test.mjs    # Regel-Tests
```

`index.html` direkt im Browser öffnen – fertig. Es wird nichts nachgeladen.

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
| `tests/` | Regel-Tests (`node --test`) |
| `RESEARCH.md` | Was aus der Vorlage übernommen wurde und was bewusst anders ist |

Der Titel steht in `src/game.js` (`TITLE_LINES`), ein neues Höhlen-Thema ist ein weiterer Eintrag in
`THEMES` in `src/cave.js`.

## Rechtliches

- Eigener Code, eigene Grafik (alles zur Laufzeit gezeichnet), eigene Sounds (synthetisch).
- Der Name «Tetris» ist eine geschützte Marke und wird deshalb weder im Spiel noch im Paketnamen verwendet.
- Schrift «Fredoka»: © The Fredoka Project Authors, SIL Open Font License 1.1.
