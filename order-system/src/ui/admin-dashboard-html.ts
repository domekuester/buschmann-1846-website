import { renderAdminShell } from './admin-page-html';
import {
  PAYMENT_OPTIONS,
  type DashboardDayView,
  type DashboardOrderRowView,
  type DonutView,
} from './dashboard-view';
import { escapeHtml } from './format';

/**
 * Das Dashboard — die Seite, die ein Bäckereibesitzer morgens als Erstes
 * ansieht.
 *
 * SIE BEANTWORTET SECHS FRAGEN UND KEINE SIEBTE:
 *
 *   Wie viele Bestellungen hat dieser Tag? Was bringt er ein? Wie viel ist
 *   noch zu tun? Wie viele Kunden? Wie viele Einheiten? Und was ist davon
 *   noch nicht bezahlt?
 *
 * Was keine dieser Fragen beantwortet, steht nicht darauf: kein
 * Vortagesvergleich, keine Prognose, keine Marge, kein Diagramm. Ein
 * Liniendiagramm über sieben Tage sähe nach Auswertung aus und wäre keine —
 * bei drei bis vierzig Bestellungen am Tag ist jede Kurve Rauschen. Die
 * Zahlen stehen groß da, weil sie groß dastehen sollen.
 *
 * DIE REIHENFOLGE IST DIE DES ARBEITSTAGS: Tag, Zahlen, Verteilung,
 * Bestellungen, Meistbestellt. Erst wie der Tag steht, dann wie er sich
 * aufteilt, dann was zu tun ist, zuletzt was einordnet. „Meistbestellt" stand bis Phase 6A.3 zwischen den Zahlen und
 * den Bestellungen — und schob damit die einzige Liste, an der etwas ZU TUN
 * ist, unter eine Liste, die nur einordnet. Wer morgens auf diese Seite
 * kommt, sucht zuerst, was offen ist; wovon am meisten weggeht, ist die
 * Frage danach.
 *
 * SIE IST NICHT DIE PRODUKTIONSANSICHT. Dort steht, WAS zu backen ist; hier
 * steht, WIE der Tag steht. Beide zeigen denselben Tag, und ein Link führt
 * hinüber — aber keine der beiden ist die längere Fassung der anderen.
 *
 * SIE TRÄGT KEIN SKRIPT. Tageswechsel und Zahlungseintrag sind echte Links
 * und echte Formulare; die Kernbedienung funktioniert ohne JavaScript, und
 * die CSP mit default-src 'none' wird nicht einmal auf die Probe gestellt.
 *
 * SIE SCHREIBT GENAU EINE SPALTE: den Zahlungsstatus einer Bestellung. Es
 * gibt hier kein Feld für Betrag, Menge, Kunde, Produktionsstatus oder Preis
 * — nicht ausgeblendet, sondern nicht vorhanden.
 */

export interface AdminDashboardPageView {
  readonly loginIdentifier: string;
  readonly csrfToken: string;
  readonly day: DashboardDayView;
  /**
   * Die Rückmeldung des letzten Speicherversuchs, als CODE und nicht als
   * Text.
   *
   * Der Wert kommt aus der Adresszeile und ist damit vom Aufrufer bestimmt.
   * Er wird deshalb NIEMALS angezeigt, sondern ausschließlich in der festen
   * Tabelle unten nachgeschlagen; ein unbekannter Code führt zu gar keiner
   * Meldung. Damit kann in dieser Meldung nichts stehen, was nicht in dieser
   * Datei steht — dieselbe Regel wie auf der Kundenseite.
   */
  readonly noticeCode: string | null;
}

const MELDUNGEN: Readonly<Record<string, string>> = {
  payment_saved: 'Der Zahlungsstatus wurde gespeichert.',
  unknown_order: 'Diese Bestellung gibt es nicht. Der Zahlungsstatus wurde nicht gespeichert.',
  invalid: 'Die Auswahl war nicht lesbar. Der Zahlungsstatus wurde nicht gespeichert.',
  internal:
    'Der Zahlungsstatus wurde nicht gespeichert. Bitte versuche es gleich noch einmal.',
};

export function renderAdminDashboardPage(view: AdminDashboardPageView): string {
  return renderAdminShell(
    `Dashboard ${view.day.day} — Buschmann 1846`,
    view,
    'dashboard',
    `${kopf(view.day)}
    ${steuerung(view.day)}
    ${meldung(view.noticeCode)}
    ${kennzahlen(view.day)}
    ${ringzone(view.day)}
    ${view.day.isEmpty ? leereBestellliste() : bestellliste(view)}
    ${topProdukte(view.day)}`,
  );
}

/**
 * Die Seite, auf der die Tagesdaten gerade nicht geladen werden konnten.
 *
 * DER ADMIN SIEHT KEINE TECHNIK. Kein SQL, kein D1_ERROR, kein Stacktrace,
 * kein Tabellenname — der Text ist eine Konstante und wird nicht aus dem
 * Fehler gebildet. Dieselbe Regel wie auf der Produktionsseite; sie steht
 * hier noch einmal, weil eine Seite eine Seite zurückgeben soll und kein
 * JSON.
 *
 * DIE NAVIGATION BLEIBT STEHEN. Wenn ein Tag scheitert, ist der nächste Klick
 * oft genau das, was hilft.
 */
export function renderDashboardUnavailablePage(
  view: Pick<AdminDashboardPageView, 'loginIdentifier' | 'csrfToken' | 'day'>,
): string {
  return renderAdminShell(
    `Dashboard ${view.day.day} — Buschmann 1846`,
    view,
    'dashboard',
    `${kopf(view.day)}
    ${steuerung(view.day)}
    <p class="banner" role="alert">Die Tagesdaten konnten gerade nicht geladen werden.</p>
    <p class="leer">Bitte versuche es gleich noch einmal. Wenn es bleibt, melde dich bei Buschmann 1846.</p>`,
  );
}

/**
 * Der Seitenkopf — und die EINZIGE h1.
 *
 * Der TAG steht groß und ausgeschrieben, nicht das Wort „Dashboard": Wer
 * hier ankommt, weiß, auf welcher Seite er ist, und will wissen, welcher Tag
 * gemeint ist. „2026-08-28" wäre kürzer und zwänge zum Kopfrechnen des
 * Wochentags — in einem Betrieb ist der Wochentag die eigentliche
 * Information.
 *
 * DER KICKER SAGT, WELCHE ART SEITE DAS IST. „Dashboard · Tagesübersicht"
 * unterscheidet diese Seite in einem Wort von der Produktionsansicht: hier
 * der Überblick über einen Tag, dort die Liste, nach der gebacken wird.
 *
 * DER SATZ DARUNTER IST KEINE ZIERDE. Er sagt, worauf sich jede Zahl dieser
 * Seite bezieht: auf den PRODUKTIONSTAG und nicht auf den Bestelleingang.
 * Ohne ihn wäre „Umsatz 1.234 €" zweideutig — und zwar auf die Art, die
 * niemandem auffällt. Er WIEDERHOLT DAS DATUM NICHT mehr: Es steht eine
 * Zeile darüber in doppelter Größe, und ein zweites Mal genannt machte den
 * Satz lang, ohne ihn genauer zu machen.
 *
 * DER WEG ZUR PRODUKTION IST EINE NEBENAKTION. Er führt woandershin und tut
 * nichts — deshalb ein Textlink und keine Schaltfläche, und deshalb steht er
 * ab Tablet neben dem Kopf statt darunter: Was den Blick zuerst bekommt, ist
 * der Tag und nicht der Weg von ihm fort.
 */
function kopf(day: DashboardDayView): string {
  return `<header class="dashkopf">
      <div class="dashkopf__text">
        <p class="dashkopf__kicker">Dashboard <span aria-hidden="true">·</span> Tagesübersicht</p>
        <h1 class="dashkopf__tag">${escapeHtml(day.dayLabel)}</h1>
        <p class="dashkopf__vorspann">
          Alle Zahlen dieser Seite gehören zum Produktionstag — nicht dazu,
          wann bestellt wurde.
        </p>
      </div>
      <p class="dashkopf__aktion">
        <a href="/admin?date=${escapeHtml(day.day)}"
          >Produktionsansicht für diesen Tag<span aria-hidden="true"> &rarr;</span></a>
      </p>
    </header>`;
}

/**
 * Der Steuerbereich — die Tageswahl, und sonst nichts.
 *
 * SIE STEHT IN EINEM EIGENEN FELD und nicht frei im Fluss. Der Unterschied
 * ist keine Zierde: Alles unterhalb dieser Leiste ist ANZEIGE, alles darin
 * ist BEDIENUNG. Auf einer Seite, die sonst nur Zahlen zeigt, ist das die
 * einzige Stelle, an der etwas eingestellt wird — und sie soll als solche
 * erkennbar sein, ohne dass jemand es liest.
 *
 * DER INHALT IST UNVERÄNDERT die Bauart der Produktionsansicht: zwei <a> und
 * ein <form method="get">, kein Skript. Der Tag steht in der URL, also im
 * Lesezeichen, und der Browser-Zurückpfeil tut das Erwartete.
 *
 * DIE PFEILE NENNEN IHR ZIEL. „Zurück" allein sagt in einem Screenreader
 * nichts; „Vorheriger Tag, Donnerstag, 27. August 2026" sagt alles.
 *
 * DAS FORMULAR SENDET AN /admin/dashboard — eine Konstante im Quelltext. Ein
 * Formular, dessen action aus einem Parameter käme, wäre die Vorlage für eine
 * Weiterleitung nach draußen.
 */
function steuerung(day: DashboardDayView): string {
  return `<div class="tagleiste">
      <nav class="tagnav tagnav--leiste" aria-label="Tag wechseln">
        <a
          class="tagnav__pfeil"
          href="/admin/dashboard?date=${escapeHtml(day.previousDay)}"
          rel="prev"
          aria-label="Vorheriger Tag, ${escapeHtml(day.previousDayLabel)}"
        ><span aria-hidden="true">&larr;</span></a>

        <form class="tagnav__formular" method="get" action="/admin/dashboard">
          <label for="dashboardtag">Tag wählen</label>
          <input type="date" id="dashboardtag" name="date" value="${escapeHtml(day.day)}" required>
          <button type="submit" class="senden tagnav__senden">Anzeigen</button>
        </form>

        <a
          class="tagnav__pfeil"
          href="/admin/dashboard?date=${escapeHtml(day.nextDay)}"
          rel="next"
          aria-label="Nächster Tag, ${escapeHtml(day.nextDayLabel)}"
        ><span aria-hidden="true">&rarr;</span></a>
      </nav>
    </div>`;
}

/**
 * SECHS KARTEN, EINE ZAHL JE KARTE — ABER NICHT SECHS GLEICH LAUTE.
 *
 * VIER FRAGEN ZUERST, ZWEI DANACH. Bis Phase 6B standen alle sechs Karten
 * gleichberechtigt nebeneinander, und sechs gleich große Zahlen sind keine
 * Rangfolge, sondern eine Wand. Vorn stehen jetzt die vier, nach denen
 * morgens tatsächlich jemand sucht: wie viel ist los, was bringt es, was ist
 * noch zu tun, was ist noch nicht bezahlt. Kunden und Einheiten ordnen ein
 * und stehen dahinter — in derselben Tafel, aber leiser gesetzt. Sie sind
 * nicht unwichtig; sie sind nur nicht die Frage des Morgens.
 *
 * DER OFFENE BETRAG SCHLIESST DIE ERSTE REIHE UND WIRD HERVORGEHOBEN, solange
 * er nicht null ist. Er ist die einzige Zahl der Seite, die zu einer Handlung
 * auffordert — und die einzige, die bei null verschwinden dürfte, es aber
 * nicht tut: „0,00 € offen" ist eine gute Nachricht und soll lesbar sein.
 *
 * DIE WAND STEHT AUCH AN EINEM LEEREN TAG. Sechs Nullen sind keine schöne
 * Antwort, aber sie sind DIE Antwort — und eine Seite, die an einem ruhigen
 * Tag die Hälfte ihres Aufbaus verliert, sieht aus wie ein Ladefehler. Wer
 * den Tag wechselt, soll dieselbe Seite wiederfinden und nicht eine zweite.
 *
 * KEINE FARBEN ALS EINZIGE AUSSAGE. Was hervorgehoben ist, sagt es auch im
 * Text; ein Betrieb, der die Seite auf einem verwaschenen Tresenbildschirm
 * liest, soll nichts an einem Farbton erkennen müssen.
 */
function kennzahlen(day: DashboardDayView): string {
  return `<section class="kennzahlwand" aria-labelledby="kennzahlen-titel">
      <h2 id="kennzahlen-titel" class="nur-vorlesen">Kennzahlen des Tages</h2>
      <div class="kennzahlwand__gitter">
        ${karte('Bestellungen', String(day.orderCount), storniertHinweis(day))}
        ${karte('Umsatz', day.revenueLabel, 'ohne stornierte', 'haupt')}
        ${karte('Offen / in Arbeit', String(day.openCount), 'noch nicht abgeschlossen')}
        ${karte(
          'Noch nicht bezahlt',
          day.unpaidLabel,
          `${day.unpaidCount} ${day.unpaidCount === 1 ? 'Bestellung' : 'Bestellungen'}`,
          day.unpaidCount > 0 ? 'betont' : null,
        )}
        ${karte('Kunden', String(day.customerCount), 'verschiedene Betriebe', 'zweit')}
        ${karte('Einheiten', String(day.totalUnits), 'bestellte Menge', 'zweit')}
      </div>
    </section>`;
}

/**
 * Eine Zelle der Wand — und die einzige Stelle, an der eine Kennzahl ein
 * anderes Gewicht bekommt als ihre Nachbarn.
 *
 * ES GIBT GENAU DREI ABWEICHUNGEN, und jede ist begründet:
 *
 *   `haupt` (Umsatz) trägt die Zahl, nach der auf dieser Seite zuerst
 *   gesucht wird. Sie steht eine Stufe größer da — und sonst identisch:
 *   keine zweite Farbe, kein Rahmen, kein Symbol. Eine Rangfolge, die man
 *   sieht, ohne sie zu bemerken.
 *
 *   `betont` (Noch nicht bezahlt) ist die einzige Zahl der Seite, die zu
 *   einer Handlung auffordert — und nur, solange sie nicht null ist.
 *
 *   `zweit` (Kunden, Einheiten) sind die beiden Zahlen, die einordnen statt
 *   zu treiben. Sie stehen kleiner und auf gedecktem Grund in der zweiten
 *   Reihe derselben Tafel — nicht ausgelagert, nicht versteckt, nur leiser.
 *
 * Weitere Modifikatoren wären die Absage an die Aussage „das hier ist EIN
 * Block": Wenn jede Zelle anders aussieht, sieht man sechs Zellen und keine
 * Wand.
 */
function karte(
  label: string,
  wert: string,
  hinweis: string,
  variante: 'haupt' | 'betont' | 'zweit' | null = null,
): string {
  return `<div class="kennzahlkarte${variante === null ? '' : ` kennzahlkarte--${variante}`}">
          <p class="kennzahlkarte__label">${escapeHtml(label)}</p>
          <p class="kennzahlkarte__wert">${escapeHtml(wert)}</p>
          ${hinweis === '' ? '' : `<p class="kennzahlkarte__hinweis">${escapeHtml(hinweis)}</p>`}
        </div>`;
}

/**
 * DIE VERTEILUNG DES TAGES — zwei Ringe und kein drittes Diagramm.
 *
 * WARUM ÜBERHAUPT EIN DIAGRAMM, wo diese Datei ein Liniendiagramm über sieben
 * Tage ausdrücklich ablehnt? Weil der Unterschied nicht „Diagramm ja/nein"
 * ist, sondern was gezeigt wird. Eine Kurve über sieben Tage BEHAUPTET einen
 * Verlauf, den drei bis vierzig Bestellungen am Tag nicht hergeben — sie
 * zeigt Rauschen und sieht nach Auswertung aus. Ein Ring über EINEN Tag
 * behauptet nichts: Er zeigt ein Verhältnis, das ohnehin feststeht, und zwar
 * schneller, als man zwei Zahlen im Kopf ins Verhältnis setzt. „Vier von
 * fünf sind bezahlt" ist auf einen Blick da; aus „Umsatz 130,50 €" und
 * „offen 69,60 €" muss man es rechnen.
 *
 * ZWEI RINGE UND NICHT FÜNF. Es gibt genau zwei Fragen, deren Antwort ein
 * Verhältnis ist: Wie viel vom Tag ist bezahlt, und wo stehen die
 * Bestellungen. Alles andere auf dieser Seite ist eine einzelne Zahl oder
 * eine Liste, und beides wird durch einen Kreis nicht besser.
 *
 * KEINE BIBLIOTHEK. Zwei Ringe sind zwei <circle> mit `stroke-dasharray` —
 * das ist der ganze Aufwand. Eine Diagrammbibliothek brächte JavaScript auf
 * eine Seite, die keines hat, und stünde damit gegen `script-src 'self'`
 * ebenso wie gegen den Grundsatz dieser Oberfläche, dass die Kernbedienung
 * ohne Skript funktioniert. Sie wäre zudem der erste fremde Code im
 * Auslieferungspfad einer Seite, die einen Bäckereibetrieb anmeldet.
 *
 * DIE GRAFIK TRÄGT KEINE INFORMATION, DIE NICHT DANEBEN STEHT. Das <svg> ist
 * `aria-hidden`; jede Zahl, jeder Anteil und jede Beschriftung steht als Text
 * in der Legende. Damit ist der Ring genau das, was er sein soll — eine
 * schnellere Lesart derselben Angaben — und niemals die einzige.
 */
function ringzone(day: DashboardDayView): string {
  return `<div class="ringzone">
      ${ringtafel('Zahlungen', 'zahlungsring', day.paymentDonut, 'Für diesen Tag ist noch keine Bestellung eingegangen. Sobald eine vorliegt, steht hier, wie viel davon bezahlt ist.')}
      ${ringtafel('Bestellstatus', 'statusring', day.statusDonut, 'Für diesen Tag ist noch keine Bestellung eingegangen. Sobald eine vorliegt, steht hier, wo sie steht.')}
    </div>`;
}

/**
 * Eine Ringtafel: Kopf, Ring, Legende.
 *
 * DER LEERE TAG BEKOMMT DENSELBEN RING, nur ohne Stücke — eine vollständige
 * Spur in der ruhigen Leinenfarbe, eine 0 in der Mitte und ein Satz statt der
 * Legende. Ein Diagramm, das an einem stillen Tag verschwindet, macht die
 * Seite an genau dem Tag unvollständig, an dem jemand zum ersten Mal
 * nachsieht, ob überhaupt etwas los ist.
 */
function ringtafel(titel: string, id: string, ring: DonutView, leerText: string): string {
  return `<section class="tafel ringtafel" aria-labelledby="${escapeHtml(id)}-titel">
        <div class="tafel__kopf">
          <h2 id="${escapeHtml(id)}-titel" class="tafel__titel">${escapeHtml(titel)}</h2>
          ${
            ring.isEmpty
              ? ''
              : `<p class="tafel__meta">${escapeHtml(ring.totalCountLabel)}</p>`
          }
        </div>
        <div class="ringtafel__inhalt">
          <div class="ring">
            ${ringGrafik(ring)}
            <p class="ring__mitte">
              <span class="ring__zahl">${escapeHtml(ring.totalLabel)}</span>
              <span class="ring__wort">${escapeHtml(ring.totalCaption)}</span>
            </p>
          </div>
          ${ring.isEmpty ? `<p class="ringlegende__leer">${escapeHtml(leerText)}</p>` : ringLegende(ring)}
        </div>
      </section>`;
}

/**
 * Der Ring als SVG.
 *
 * `aria-hidden` und `focusable="false"`: Die Grafik ist die Zweitfassung der
 * Legende und soll in keiner Vorlesereihenfolge und in keinem Tabulaturweg
 * auftauchen — der Internet Explorer machte SVGs sonst fokussierbar, und
 * einige Screenreader lesen sonst „Grafik" ohne jeden Inhalt vor.
 *
 * `stroke-dasharray` und `stroke-dashoffset` stehen als ATTRIBUTE da und
 * nicht als Stil. Die Begründung steht in dashboard-view.ts: Die CSP dieser
 * Anwendung kennt kein `'unsafe-inline'` für Stile, und ein `style="…"` am
 * Segment würde stillschweigend verworfen.
 */
function ringGrafik(ring: DonutView): string {
  const stuecke = ring.isEmpty
    ? ''
    : ring.segments
        .filter((segment) => segment.count > 0)
        .map(
          (segment) => `<circle
            class="ring__stueck ring__stueck--${escapeHtml(segment.key)}"
            cx="21" cy="21" r="15.9155"
            stroke-dasharray="${escapeHtml(segment.dashArray)}"
            stroke-dashoffset="${escapeHtml(segment.dashOffset)}"
          />`,
        )
        .join('\n          ');

  return `<svg class="ring__grafik" viewBox="0 0 42 42" aria-hidden="true" focusable="false">
              <g transform="rotate(-90 21 21)">
                <circle class="ring__spur" cx="21" cy="21" r="15.9155" />
                ${stuecke}
              </g>
            </svg>`;
}

/**
 * Die Legende — und der eigentliche Inhalt der Tafel.
 *
 * Jede Zeile nennt das Wort, die Anzahl und, wo es einen gibt, den Betrag.
 * Die Farbmarke davor ist `aria-hidden`: Sie ordnet dem Ring zu, sie sagt
 * nichts. Wer die Farben nicht unterscheiden kann — oder die Seite auf einem
 * verwaschenen Tresenbildschirm liest —, verliert damit keine Angabe.
 */
function ringLegende(ring: DonutView): string {
  return `<ul class="ringlegende">
            ${ring.segments
              .map(
                (segment) => `<li class="ringlegende__zeile">
              <span class="ringlegende__marke ringlegende__marke--${escapeHtml(
                segment.key,
              )}" aria-hidden="true"></span>
              <span class="ringlegende__wort">${escapeHtml(segment.label)}</span>
              <span class="ringlegende__zahl">${escapeHtml(segment.countLabel)}</span>
              ${
                segment.detailLabel === ''
                  ? ''
                  : `<span class="ringlegende__betrag">${escapeHtml(segment.detailLabel)}</span>`
              }
            </li>`,
              )
              .join('\n            ')}
            ${
              ring.footnote === ''
                ? ''
                : `<li class="ringlegende__fussnote">${escapeHtml(ring.footnote)}</li>`
            }
          </ul>`;
}

/**
 * „zusätzlich 1 storniert" — und nur dann, wenn es stimmt.
 *
 * „ZUSÄTZLICH" UND NICHT „DAVON": orderCount zählt die stornierten gar nicht
 * mit (siehe domain/dashboard-day.ts). „davon 1 storniert" unter einer 5
 * behauptete, es seien vier übrig — tatsächlich sind es fünf und eine sechste
 * ist zurückgezogen. Ein Wort, das die Summe falsch erklärt, ist schlimmer
 * als keines.
 *
 * Eine Zeile „zusätzlich 0 storniert" wäre Rauschen an der Stelle, an der ein
 * Betrieb eine Zahl sucht. Sie erscheint, solange die Antwort nicht null ist —
 * dieselbe Regel wie bei den offenen Zuordnungen auf der Kundenseite.
 */
function storniertHinweis(day: DashboardDayView): string {
  return day.cancelledCount === 0 ? '' : `zusätzlich ${day.cancelledCount} storniert`;
}

/**
 * „Meistbestellt" — nach MENGE, nicht nach Umsatz.
 *
 * Die Begründung steht in domain/dashboard-day.ts: Auf einer Seite, die ein
 * Betrieb morgens liest, ist „wovon geht am meisten weg" die brauchbare
 * Aussage; nach Umsatz sortiert stünde oben, was teuer ist. Weil man das der
 * Liste nicht ansieht, steht es als kleine Angabe im Kopf der Tafel — nicht
 * als Fußnote unter der Seite, wo es niemand mit der Liste verbindet.
 *
 * DIE RANGZIFFER STEHT SEIT PHASE 6B WIEDER DA — als Ziffer und nicht als
 * Medaille. Die frühere Fassung ließ die Nummerierung des <ol> ausblenden mit
 * der Begründung, ein „1." vor dem meistbestellten Kuchen lese sich wie eine
 * Platzierung in einem Wettbewerb. Das stimmt für ein fettes „1." am
 * Zeilenanfang; es stimmt nicht für eine schmale, gedeckte Ziffer in einer
 * eigenen Spalte. Die tut etwas anderes: Sie gibt fünf verschieden langen
 * Produktnamen eine gemeinsame linke Kante und macht die Liste als Reihenfolge
 * lesbar, statt sie wie eine zufällige Aufzählung aussehen zu lassen.
 *
 * Sie ist `aria-hidden`: Das <ol> trägt die Reihenfolge bereits, und ein
 * vorgelesenes „eins Beispiel Käsekuchen elf Stück" wäre eine Zahl zu viel.
 *
 * DER ABSCHNITT BLEIBT STEHEN, AUCH WENN ER LEER IST. Die frühere Fassung
 * ließ ihn verschwinden; das machte die Seite an einem ruhigen Tag kürzer und
 * unvollständiger, und wer sie zum ersten Mal an so einem Tag sah, wusste
 * nicht, dass es diesen Abschnitt gibt. Ein Satz sagt, was fehlt, und nimmt
 * denselben Platz ein wie die Liste, die morgen dort steht.
 */
function topProdukte(day: DashboardDayView): string {
  const inhalt =
    day.topProducts.length === 0
      ? `<p class="tafel__leer">Für diesen Tag ist noch kein Produkt bestellt. Sobald eine Bestellung eingeht, steht hier, wovon am meisten gebraucht wird.</p>`
      : `<ol class="topliste">
        ${day.topProducts
          .map(
            (line, index) => `<li class="topliste__zeile">
          <span class="topliste__rang" aria-hidden="true">${index + 1}</span>
          <span class="topliste__name">${escapeHtml(line.name)}</span>
          <span class="topliste__menge"><span class="topliste__zahl">${
            line.quantity
          }</span> <span class="topliste__einheit">${escapeHtml(line.unit)}</span></span>
        </li>`,
          )
          .join('\n        ')}
      </ol>`;

  return `<section class="tafel topprodukte" aria-labelledby="topprodukte-titel">
      <div class="tafel__kopf">
        <h2 id="topprodukte-titel" class="tafel__titel">Meistbestellt</h2>
        <p class="tafel__meta">nach Menge</p>
      </div>
      ${inhalt}
    </section>`;
}

/**
 * Die Bestellungen des Tages — als TABELLE, weil die Daten eine sind.
 *
 * Gleichartige Zeilen, benannte Spalten, eine Kopfzeile, die sie benennt.
 * Dieselbe `.datentabelle`, die Kunden- und Katalogseite benutzen: Auf
 * schmalen Geräten zerfällt sie in Karten mit Beschriftung je Zelle, auf
 * breiten wird sie zur Tabelle. Ein geschrumpfter Desktop-Tabellenkörper mit
 * seitlichem Scrollen wäre auf einem Tresengerät unbenutzbar.
 *
 * DIE TAFEL UM DIE TABELLE GILT ERST AB TABLET. Darunter ist die Tabelle
 * selbst schon eine Reihe von Karten; eine Karte in einer Karte ist ein
 * Rahmen zu viel. Der Kopf mit der Überschrift steht auf beiden Breiten —
 * er ist es, der den Abschnitt zum Abschnitt macht.
 *
 * DIE BESTELLNUMMER STEHT IN EINEM <th scope="row">: Sie benennt die Zeile.
 * Ein Screenreader liest damit bei jeder Zelle mit, um welche Bestellung es
 * geht.
 *
 * STORNIERTE BESTELLUNGEN BLEIBEN IN DER LISTE und tragen ein WORT, nicht nur
 * eine Farbe. Sie zu verstecken machte die Seite ruhiger und unehrlich: Wer
 * wissen will, warum der Tag dünn aussieht, muss die Stornierung sehen.
 */
function bestellliste(view: AdminDashboardPageView): string {
  return `<section class="tafel tafel--tabelle bestellliste" aria-labelledby="bestellliste-titel">
      <div class="tafel__kopf">
        <h2 id="bestellliste-titel" class="tafel__titel">Bestellungen</h2>
        <p class="tafel__meta">${view.day.orders.length} ${
          view.day.orders.length === 1 ? 'Eintrag' : 'Einträge'
        }</p>
      </div>
      <div class="datentabelle-wrap">
        <table class="datentabelle">
          <thead><tr>
            <th scope="col">Bestellung</th>
            <th scope="col">Kunde</th>
            <th scope="col">Produktion</th>
            <th scope="col" class="spalte-betrag">Betrag</th>
            <th scope="col">Zahlung</th>
            <th scope="col">Zahlungsstatus ändern</th>
          </tr></thead>
          <tbody>${view.day.orders
            .map((order) => bestellzeile(order, view.csrfToken))
            .join('')}</tbody>
        </table>
      </div>
    </section>`;
}

/**
 * Der Tag, an dem nichts bestellt wurde.
 *
 * ER SIEHT AUS WIE JEDER ANDERE TAG, nur mit Nullen. Kopf, Steuerung,
 * Kennzahlenwand und beide Tafeln stehen an derselben Stelle; was fehlt, sind
 * die Zeilen — und an ihrer Stelle steht ein Satz, der sagt, dass hier nichts
 * fehlt, sondern nichts ist.
 *
 * KEINE ALARMÄSTHETIK. Ein ruhiger Tag ist kein Fehler: kein Warnzeichen,
 * kein roter Grund, kein „Achtung". Dieselbe Tafel, derselbe Rahmen, ein
 * gedeckter Satz.
 */
function leereBestellliste(): string {
  return `<section class="tafel bestellliste" aria-labelledby="bestellliste-titel">
      <div class="tafel__kopf">
        <h2 id="bestellliste-titel" class="tafel__titel">Bestellungen</h2>
      </div>
      <p class="tafel__leer">
        Für diesen Tag liegt noch keine Bestellung vor. Sobald eine Bestellung
        für diesen Produktionstag eingeht, erscheint sie hier.
      </p>
    </section>`;
}

function bestellzeile(order: DashboardOrderRowView, csrfToken: string): string {
  return `<tr${order.isCancelled ? ' class="bestellzeile--storniert"' : ''}>
      <th scope="row" data-label="Bestellung">
        <span class="bestellzeile__nummer">${escapeHtml(order.orderNumber)}</span>
        <span class="bestellzeile__zeit">${escapeHtml(order.orderedAtLabel)}</span>
      </th>
      <td data-label="Kunde"><span class="bestellzeile__kunde">${escapeHtml(
        order.customerName,
      )}</span><span class="bestellzeile__art">${escapeHtml(order.fulfillmentLabel)}</span></td>
      <td data-label="Produktion">${
        order.isCancelled
          ? `<span class="bestellzeile__storno">${escapeHtml(order.statusLabel)}</span>`
          : escapeHtml(order.statusLabel)
      }</td>
      <td data-label="Betrag" class="bestellzeile__betrag">${escapeHtml(order.amountLabel)}</td>
      <td data-label="Zahlung">${
        order.isPaid
          ? `<span class="zahlstand zahlstand--bezahlt">${escapeHtml(order.paymentStatusLabel)}</span>`
          : `<span class="zahlstand zahlstand--offen">${escapeHtml(order.paymentStatusLabel)}</span>`
      }</td>
      <td data-label="Zahlungsstatus ändern" class="zahlungaktion">${zahlungsformular(
        order,
        csrfToken,
      )}</td>
    </tr>`;
}

/**
 * Das Zahlungsformular EINER Zeile.
 *
 * DIE BESTELLUNG STEHT IM PFAD und nicht im Körper. Damit gibt es kein Feld,
 * über das sich eine andere Bestellung unterschieben ließe — und der Server
 * prüft den Pfad ohnehin, bevor er irgendetwas schreibt.
 *
 * IM KÖRPER STEHEN GENAU ZWEI FELDER: der CSRF-Token der Sitzung und der
 * gewünschte Zahlungsstand. Kein Betrag, kein Kunde, kein Produktionsstatus,
 * kein Rückkehrziel. Was nicht im Formular steht, wird auch nicht gelesen —
 * und ein Betragsfeld an dieser Stelle wäre der Anfang eines Kassensystems.
 *
 * EIN AUSWAHLFELD UND EINE SCHALTFLÄCHE, nicht fünf Schaltflächen. Anders als
 * beim Statuswechsel, wo jede Aktion einen eigenen Knopf hat, weil sie einen
 * Schritt bedeutet: Hier wird kein Schritt getan, sondern ein Stand
 * eingetragen — und der bestehende Stand soll dabei sichtbar vorausgewählt
 * sein. Fünf Knöpfe zeigten nicht, wo die Bestellung gerade steht.
 *
 * DAS LABEL NENNT DIE BESTELLNUMMER. „Zahlungsstatus" allein käme in einem
 * Screenreader zwanzigmal gleich an; „Zahlungsstatus für Bestellung
 * BUS-2026-000001" sagt, worüber gerade entschieden wird. Sichtbar ist es
 * nicht — die Spaltenüberschrift sagt es Sehenden bereits.
 *
 * AUCH EINE STORNIERTE BESTELLUNG BEKOMMT EIN FORMULAR. Sie kann bezahlt
 * worden sein, bevor sie storniert wurde; das nachzutragen darf die Seite
 * nicht verhindern. Auf den Umsatz wirkt es weiterhin nicht.
 */
function zahlungsformular(order: DashboardOrderRowView, csrfToken: string): string {
  const feldId = `zahlung-${order.orderNumber}`;
  const ziel = encodeURIComponent(order.orderNumber);

  return `<form method="post" action="/api/admin/orders/${escapeHtml(ziel)}/payment" class="zahlung">
        <input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}">
        <label class="nur-vorlesen" for="${escapeHtml(feldId)}">Zahlungsstatus für Bestellung ${escapeHtml(
          order.orderNumber,
        )}</label>
        <select id="${escapeHtml(feldId)}" name="payment_status" class="zahlung__wahl">
          ${PAYMENT_OPTIONS.map(
            (option) =>
              `<option value="${escapeHtml(option.value)}"${
                option.value === order.paymentStatus ? ' selected' : ''
              }>${escapeHtml(option.label)}</option>`,
          ).join('\n          ')}
        </select>
        <button type="submit" class="senden zahlung__senden">Speichern</button>
      </form>`;
}

/**
 * Die Rückmeldung nach dem Speichern.
 *
 * ERFOLG UND FEHLSCHLAG SEHEN NICHT GLEICH AUS. `.banner` ist im ganzen
 * System die FEHLERdarstellung — roter Grund, vorangestelltes Warnzeichen.
 * „Der Zahlungsstatus wurde gespeichert." mit einem Warndreieck davor wäre
 * eine Meldung, die ihrer eigenen Aussage widerspricht.
 *
 * role="status" und nicht role="alert": Der Vorgang ist abgeschlossen, die
 * Meldung unterbricht niemanden.
 */
function meldung(code: string | null): string {
  if (code === null) return '';
  const text = Object.prototype.hasOwnProperty.call(MELDUNGEN, code) ? MELDUNGEN[code] : null;
  if (text === undefined || text === null) return '';

  const klasse =
    code === 'payment_saved' ? 'kundenmeldung kundenmeldung--erfolg' : 'banner kundenmeldung';

  return `<p class="${klasse}" role="status">${escapeHtml(text)}</p>`;
}
