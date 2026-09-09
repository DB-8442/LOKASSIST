# LOKASSIST

Version **1.2.1** – robuster Fahrplandaten-Abruf, vollständige lokale Backups und dauerhaftes Dienstarchiv.

## Backup und Wiederherstellung

Unter **Mehr → Vollständige Datensicherung** eine JSON-Datei speichern oder
wiederherstellen. Dateiname: `lokassist-backup-v1-YYYY-MM-DD.json`.
Die Datei enthält persönliche Angaben im Klartext und sollte außerhalb der
App an einem geschützten Ort aufbewahrt werden. Das Auslösen des Downloads
bestätigt noch nicht, dass die Datei tatsächlich im Dateisystem abgelegt wurde.

Der Umschlag enthält `app: "LOKASSIST"`, `appVersion`, `formatVersion: 1`,
`exportedAt` (UTC) und das vollständige Objekt `data`:

| Feld in `data` | localStorage-Schlüssel | Inhalt |
| --- | --- | --- |
| `tfRides` | `tfRides` | Tf-Fahrten mit Notizen, gespeicherten Zugläufen, Fahrzeugen und Dienstverweisen |
| `rides` | `rides` | Ausbildungsfahrten einschließlich Beobachtungen und Halten |
| `services` | `lokassistentServices` | Vollständiges Dienstarchiv, auch Dienste ohne Fahrt |
| `currentService` | `lokassistentCurrentService` | Aktueller oder zuletzt beendeter Dienst, identisch zum Archiveintrag; sonst `null` |
| `vehicles` | `lokassistentCurrentVehicles` | Aktueller Fahrzeugverband, einschließlich noch unvollständiger Eingabezeilen |
| `profile` | `lokassistentProfile` | Name, Meldestelle und E-Mail |

Alle sechs Bereiche sind Pflicht; leere Listen/Profil oder ein `null`-Dienst
sind gültig. Unbekannte Felder und Formatversionen, falsche Datentypen,
ungültige Zeitangaben, doppelte IDs, fehlende Dienstreferenzen und
widersprüchliche aktive Dienste werden vor der Bestätigung zurückgewiesen.
Verschachtelte Fahrpläne, Fahrzeuge, Ausbildungsbeobachtungen und Halte werden
ebenfalls geprüft. Historische Tf-Fahrten dürfen die in älteren App-Versionen
noch nicht vorhandenen optionalen Zusatzfelder auslassen. Sicherheitsgrenzen:
20 MB pro Datei, 100.000 Listeneinträge bzw. Zeichen je Textfeld, maximal drei
Fahrzeuge. Fehlerhafte Dateien bewirken keine Schreibzugriffe.

Bewusst ausgeschlossen:

- `appPin`: Die bestehende lokale PIN bleibt beim Restore unverändert.
- `tfTripSel:*` / `tripSel:*`: Merken nur die Auswahl einer API-Verbindung
  für Datum/Zugnummer. Gespeicherte Fahrten enthalten ihren eigenen Zuglauf;
  die Auswahlhilfen sind kein fachliches Archiv. Sie werden nicht exportiert
  und beim Restore nicht verändert.
- Service-Worker-/App-/API-Caches und unbekannte Fremdschlüssel.
- `lokassistentStorageTransaction`: internes Wiederherstellungsjournal,
  kein fachliches Datum und kein Bestandteil regulärer Backups.

Ein vollständiger Restore ersetzt die sechs Bereiche nach ausdrücklicher
Bestätigung. Anschließend werden Verlauf, Dienstanzeige, Profil und Fahrzeuge
neu angezeigt und ungespeicherte Formulare zurückgesetzt. Das tatsächlich in
1.1.0 exportierte Ausbildungsformat `{version: 2, exportedAt, rides}` wird nach
derselben Prüfung seiner Datensätze unterstützt: Es ersetzt ausschließlich
Ausbildungsfahrten. Andere Altformate werden mit einer Fehlermeldung abgelehnt.
Der Ausbildungsbereich bleibt ausgeblendet; seine Daten und Funktionen bleiben
erhalten.

## Dienstarchiv und Migration

Beim ersten Start ohne `lokassistentServices` wird der bestehende aktuelle bzw.
zuletzt beendete Dienst mit seiner ID, Bezeichnung, Datum, Beginn, Ende, Status
und vorhandenen Zeitstempeln übernommen. Fehlende Abschlussfelder eines aktiven
Dienstes werden zu `null`; `updatedAt` verwendet zunächst `createdAt`, sofern
vorhanden. Die Migration verändert bestehende Fahrten nicht und wird bei
vorhandenem Archiv nicht erneut ausgeführt.

Für weitere Dienst-IDs in vorhandenen Tf-Fahrten entstehen Archiveinträge aus
Bezeichnung und Dienstdatum. Bereits früher überschriebene Beginn-/Endzeiten
sind nicht rekonstruierbar: Diese Einträge haben `status: "unknown"`,
`reconstructed: true` und unbekannte Zeiten als `null`. Frühere Dienste ohne
Fahrt, die schon vor 1.2.0 überschrieben wurden, können nicht wiederhergestellt
werden. Ab 1.2.0 bleiben auch Dienste ohne Fahrten im Archiv erhalten.

Ein neuer Dienst erhält eine UUID. Start und Feierabend aktualisieren Archiv
und aktuellen Dienst gemeinsam. Ein zweiter aktiver Dienst wird abgewiesen.
Neue Tf-Fahrten übernehmen den aktiven Dienst; beim Bearbeiten wird die
Zuordnung aus dem gespeicherten Datensatz beibehalten, einschließlich einer
bisher fehlenden Zuordnung. Auch ein erneutes Laden des Zuglaufs erhält die
Fahrt-ID. Fahrzeugänderungen an historischen Fahrten überschreiben den
aktuellen Fahrzeugverband nicht.

## Verhalten bei Speicherfehlern

localStorage bietet keine Transaktion über mehrere Schlüssel. Vor Migration,
Dienständerung und Restore speichert die App daher die bisherigen Rohwerte der
betroffenen Schlüssel in einem Journal. Schreibfehler lösen eine Rücksetzung
aus. Ein beim Schließen unterbrochener Vorgang wird beim nächsten Start auf den
vorherigen Bestand zurückgesetzt. Wenn auch die Rücksetzung fehlschlägt, bleibt
das Journal für einen erneuten Versuch erhalten; ein erfolgloser Start blockiert
die App mit einer verständlichen Meldung. Keine Websitedaten löschen.

Das Journal benötigt vorübergehend zusätzlichen Speicher. Reicht dieser nicht
aus, wird der Vorgang abgelehnt. Dies ist keine Umstellung auf IndexedDB und
keine Garantie gegen Verlust aller Browserdaten. Wiederherstellungen sollten
in nur einem geöffneten App-Fenster erfolgen; parallele Schreibvorgänge aus
mehreren Fenstern sind nicht durch eine Datenbanktransaktion geschützt.

## Reproduzierbare Prüfungen

Ohne zusätzliche Pakete mit Node.js 22 oder neuer im Projektverzeichnis:

```sh
node --test tests/*.test.js
node --check storage.js
node --check sw.js
node -e "const fs=require('node:fs'),vm=require('node:vm');new vm.Script(fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);console.log('Inline-Skript: OK')"
git diff --check
```

Die Tests führen die produktive Speicherlogik mit kontrolliertem localStorage
und das vollständige Inline-Skript mit einem kleinen DOM-Adapter aus. Geprüft
werden Exportumfang/PIN-Ausschluss, erfolgreiche/abgebrochene/fehlerhafte
Imports, ungültige verschachtelte Daten, Altformat, Migration, Rücksetzung an
jedem Schreibschritt, Wiederanlauf, Diensthistorie ohne Fahrten, historische und
neue Fahrtzuordnung einschließlich erneutem Zuglaufabruf, Fahrzeugableitung,
Wenden, Reihenfolge, Dubletten-/Nummernprüfung und Aktualisierung der Formulare.
Die vorhandenen Tests zur Zuggattung bleiben unverändert. Diese Tests ersetzen
keinen echten iOS-Test des Datei-Downloads und der Dateiauswahl.

Manueller Mobil-/PWA-Test auf einer Testinstallation:

1. Einen Dienst starten, beenden und einen zweiten starten. Im Verlauf müssen
   beide mit Zeiten sichtbar sein, auch wenn der erste keine Fahrt enthält.
2. Eine alte Fahrt öffnen, bearbeiten und den Zuglauf erneut laden. Speichern
   darf weder eine zweite Fahrt erzeugen noch den Dienst wechseln.
3. Backup in „Dateien“ sichern und wieder auswählen. Vor Austausch muss die
   Bestätigung mit den Datensatzanzahlen erscheinen. Abbrechen verändert nichts.
4. Nach erfolgreichem Import Profil, Fahrzeuge und Verlauf vergleichen. Eine
   ungültige Datei muss abgelehnt werden. Die PIN bleibt bestehen.
5. Einmal online öffnen, danach offline neu laden: `storage.js` gehört zum
   Service-Worker-Cache `lokassistent-1.2.1`. Ein Cachewechsel löscht ausschließlich
   frühere App-Caches, keine localStorage-Daten.
