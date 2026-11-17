# Recherche: Vorlage (eigenes Android-Projekt)

Analysiert wurde der Quelltext des Android-Projekts (Kotlin, 22 Dateien, rund 4700 Zeilen).
**Beobachtung**, **Schlussfolgerung** und **Unbekanntes** sind getrennt festgehalten.

## Untersuchungsfragen

- [x] Welche Regeln und Zeitwerte bestimmen das Spielgefühl?
- [x] Wie funktioniert die Touch-Steuerung?
- [x] Was gehört zum Dev-Menü und entfällt?

## Befunde

| # | Frage | Beobachtung (Quelle) | Schlussfolgerung | Konfidenz |
| - | ----- | -------------------- | ---------------- | --------- |
| 1 | Feld | 10 × 20 sichtbar, 4 verdeckte Reihen darüber (`GameState.kt`, `Board.kt`) | übernommen | hoch |
| 2 | Start | Stein startet bei `y = -2`, also komplett über dem sichtbaren Feld; Game Over, wenn die Startposition belegt ist (`GameState.spawn`) | Regel übernommen; neu ist ein 2 Reihen hoher Einlauf über dem Feld, damit der Stein sofort sichtbar ist | hoch |
| 3 | Zufall | 7er-Beutel, gemischt, von hinten entnommen (`Randomizer.kt`) | übernommen; Test-Sequenzen (Dev) entfallen | hoch |
| 4 | Drehen | nur im Uhrzeigersinn, Kick-Tabelle `SIMPLE_KICKS` (7 Versätze); die SRS-Tabellen sind definiert, werden aber nicht benutzt (`Tetromino.getWallKicks`) | `SIMPLE_KICKS` übernommen | hoch |
| 5 | Zeiten | Lock-Delay 500 ms mit max. 15 Resets, DAS 170 ms, ARR 50 ms, Hard-Drop-Sperre 50 ms, Fallzeiten 800 … 30 ms über 20 Level (`GameState.kt`) | übernommen | hoch |
| 6 | Punkte | 100/300/500/800 × Level je 1–4 Reihen, Soft Drop +1 je Zelle, Hard Drop +2 je Zelle, Level = Reihen ÷ 10 + 1 | übernommen | hoch |
| 7 | Reihenabbau | `ClearAnimation.kt` spielt GIF-Frames ab; ohne GIF verschwinden die Reihen nach `clearFreezeMs` (120 ms) | ersetzt durch Riss-Phase (240 ms) und Splitter-Effekt; die Reihen werden am Ende der Riss-Phase entfernt | hoch |
| 8 | Touch | Zonen links/rechts neben dem Feld bewegen (mit DAS); Tipp im Feld nahe am Stein dreht, sonst Bewegung zur getippten Hälfte; unten `▼`, `DROP`, `↻` (`GameSurfaceView.kt`, `MainActivity.kt`) | übernommen | hoch |
| 9 | Tastatur | Pfeile, ↑/X drehen, Leertaste Hard Drop bzw. Start, P Pause | übernommen | hoch |
| 10 | Pause | Zeitstempel laufen während der Pause weiter (`System.currentTimeMillis`), nur `lastDropTime` wird zurückgesetzt | im Port läuft eine eigene Spieluhr, die in der Pause steht – ein Stein rastet nach der Pause nicht sofort ein | hoch |
| 11 | Landehilfe | `showGhost` ist standardmässig aus und nur im Dev-Panel schaltbar | als normale Option im Menü, standardmässig an | mittel |
| 12 | Dev-Menü | GIF-Import und -Editor, Clear-Timeline, Debug-Overlay, Test-Steine (`DevPanel.kt`, `gif/`) | entfällt komplett | hoch |

## Bewusste Abweichungen

- START startet ein laufendes Spiel nicht mehr sofort neu: «Neues Spiel» liegt im Menü und fragt einmal nach.
- Der Pfeil-unten-Knopf wiederholt, solange er gehalten wird (die Vorlage macht einen Schritt pro Tipp).
- Wer eine Richtung hält, während eine Reihe zerspringt, schiebt den nächsten Stein weiter (die Vorlage verlangt neues Drücken).
- Der Rekord wird schon beim Pausieren, Verlassen und Neustarten gespeichert, nicht erst beim Game Over.
- Direkt nach dem Game Over reagieren Leertaste und «NOCHMAL» kurz nicht, damit kein Spiel versehentlich neu startet.

## Offene Fragen

- Soll die Landehilfe standardmässig an bleiben?
- Paketname und App-Symbol für die APK.
