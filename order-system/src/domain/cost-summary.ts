/**
 * ROHERTRAG UND MARGE — und die Frage, die davor steht: Darf man sie
 * überhaupt ausrechnen?
 *
 * Seit Phase 7A trägt jede Bestellposition einen Kostenschnappschuss:
 * `unit_cost_cents_snapshot`. Er darf NULL sein, und dieses NULL ist der
 * ganze Grund, warum es diese Datei gibt. Es heißt
 *
 *   „für dieses Produkt waren damals keine Herstellkosten gepflegt"
 *
 * und niemals „0 €". Der Unterschied ist der zwischen einer Auswertung und
 * einer Behauptung: Wer NULL als 0 liest, bekommt eine Marge, die umso
 * schöner aussieht, je weniger gepflegt ist — und zwar lautlos. Eine
 * Bäckerei, die nach so einer Zahl kalkuliert, kalkuliert nach der eigenen
 * Nachlässigkeit.
 *
 * DESHALB IST VOLLSTÄNDIGKEIT EIN ERGEBNIS DIESER DATEI UND KEIN GEFÜHL.
 * Fehlt an EINER relevanten Position der Kostenwert, ist die Kostenbasis des
 * betrachteten Zeitraums unvollständig, und es gibt weder Rohertrag noch
 * Marge — nicht als kleinere Zahl, nicht mit Sternchen, sondern gar nicht.
 * Was bekannt ist, wird trotzdem gezählt: `knownCostCents` sagt, wie weit man
 * ist, und `missingOrderCount` sagt, was noch fehlt.
 *
 * WAS HIER NICHT STEHT: keine Buchhaltung, keine Umsatzsteuer, keine
 * Rezeptur, kein Wareneinsatz, keine Kostenhistorie, keine Prognose. Der
 * Rohertrag dieser Datei ist Umsatz minus geschätzte Herstellkosten und
 * nennt sich auch so.
 *
 * ES WIRD IN GANZEN CENT GERECHNET — wie überall in diesem System. Der
 * einzige Bruch ist die Marge, und sie entsteht als ganzzahlige ZEHNTEL
 * PROZENT: 588 heißt 58,8 %. Eine Fließkommazahl 58.800000000000004 in einem
 * Ansichtsmodell wäre der Anfang einer Rundungsdiskussion, die auf einem
 * Dashboard niemand führen will.
 *
 * DER ZAHLUNGSSTATUS KOMMT IN DIESER DATEI NICHT VOR. Eine unbezahlte, aber
 * nicht stornierte Bestellung ist Umsatz, hat Kosten und trägt zum Rohertrag
 * bei — das Dashboard zeigt Auftragsumsatz und keinen Kassenbestand. Wer das
 * ändern wollte, müsste eine zweite Kennzahl erfinden und nicht diese
 * umdeuten.
 *
 * DER STORNOFILTER STEHT AUCH NICHT HIER. Diese Datei bekommt nur, was
 * zählt; welche Bestellung das ist, entscheidet countsTowardsRevenue() in
 * order-status.ts — an einer Stelle für Umsatz UND Kosten. Zwei Filter wären
 * zwei Gelegenheiten, dass die Kosten einer stornierten Bestellung im
 * Rohertrag landen, während ihr Umsatz fehlt.
 */

/**
 * Eine Position, SOWEIT SIE FÜR DIE KOSTEN ZÄHLT — zwei Zahlen und keine
 * dritte.
 *
 * Kein Produktname, keine Einheit, kein Verkaufspreis. Diese Datei ordnet
 * keine Kosten einem Produkt zu und kann es nicht: Sie summiert, und die
 * Summe ist die einzige Frage, die sie beantwortet.
 *
 * Der Typ ist bewusst STRUKTURELL und nicht nominal — sowohl die Position des
 * Tagesüberblicks als auch die schlanke Wochenposition erfüllen ihn, ohne ihn
 * zu erwähnen. Eine gemeinsame Basisklasse hätte zwei Lesemodelle aneinander
 * gebunden, die sonst nichts miteinander zu tun haben.
 */
export interface CostItem {
  readonly quantity: number;
  /** Der Kostenschnappschuss je Einheit — oder null für „unbekannt". */
  readonly unitCostCents: number | null;
}

/**
 * Was am Ende einer Zählung feststeht.
 *
 * DIE ROHEN ZÄHLER SIND ALLE ADDITIV UND GANZZAHLIG. Genau deshalb kann eine
 * Woche aus sieben Tagen entstehen, ohne dass irgendwo Prozentwerte gemittelt
 * werden — der klassische Fehler, bei dem ein umsatzschwacher Tag mit hoher
 * Marge die Woche schöner macht, als sie war.
 *
 * `complete`, `grossProfitCents` und `marginTenthsPercent` sind dagegen
 * ABGELEITET und werden bei jeder Zusammenfassung neu gebildet. Sie stehen
 * nie in einer Summe.
 */
export interface CostSummary {
  /** Der Umsatz, auf den sich alles hier bezieht — HEREINGEREICHT, nicht neu gezählt. */
  readonly revenueCents: number;
  /** Die Summe der BEKANNTEN Herstellkosten. Bei unvollständiger Basis ein Teilbetrag. */
  readonly knownCostCents: number;
  /** Relevante Positionen insgesamt. */
  readonly itemCount: number;
  /** Davon ohne Kostenschnappschuss. */
  readonly missingItemCount: number;
  /** Relevante Bestellungen insgesamt. */
  readonly orderCount: number;
  /** Davon mit mindestens einer Position ohne Kostenschnappschuss. */
  readonly missingOrderCount: number;
  /**
   * Jede relevante Position trägt einen Kostenwert.
   *
   * Ein Zeitraum ohne jede Position ist vollständig — es fehlt nichts. Das
   * ist kein Trick: Ein leerer Tag hat 0,00 € Umsatz und 0,00 € Kosten, und
   * beide Zahlen sind wahr. Eine Marge bekommt er trotzdem nicht, weil man
   * durch null Umsatz nicht teilt.
   */
  readonly complete: boolean;
  /**
   * Umsatz minus Herstellkosten — oder null, wenn die Basis unvollständig
   * ist.
   *
   * NULL HEISST „NICHT BERECHENBAR" und nicht „0 €". Derselbe Unterschied
   * wie beim Kostenschnappschuss selbst, eine Ebene höher.
   *
   * ER DARF NEGATIV SEIN. Kosten über dem Umsatz sind ein betrieblicher
   * Befund und kein Fehler — eine Aktionsware unter Einstand, ein
   * Kalkulationsirrtum, ein zu billig verkauftes Blech. Auf 0 geklemmt wäre
   * genau die Zahl unsichtbar, für die jemand diese Auswertung anschaut.
   */
  readonly grossProfitCents: number | null;
  /**
   * Die Marge in ZEHNTEL PROZENT — 588 heißt 58,8 %.
   *
   * null, wenn die Kostenbasis unvollständig ist ODER der Umsatz null ist.
   * Der zweite Fall ist keine Feinheit: Ein Tag ohne Umsatz hätte eine
   * Division durch null, und „Infinity %" oder „NaN %" auf einem Dashboard
   * ist der Punkt, an dem ein Betrieb der ganzen Seite nicht mehr glaubt.
   */
  readonly marginTenthsPercent: number | null;
}

/**
 * Der Zähler, WÄHREND gezählt wird.
 *
 * WARUM EIN VERÄNDERLICHES OBJEKT IN EINER SONST REINEN DOMÄNE: weil es in
 * denselben EINEN Durchlauf gehört wie der Umsatz. Der Tagesüberblick zählt
 * seine Bestellungen in einer Schleife mit genau einem Stornofilter; eine
 * zweite, reine Funktion über dieselbe Liste wäre ein zweiter Durchlauf mit
 * einem zweiten Filter — und damit die Möglichkeit, dass Umsatz und Kosten
 * verschiedene Bestellungen meinen.
 *
 * Nach außen tritt trotzdem nichts Veränderliches: summary() gibt eine
 * fertige, unveränderliche Zusammenfassung zurück.
 */
export class CostTally {
  private knownCostCents = 0;
  private itemCount = 0;
  private missingItemCount = 0;
  private orderCount = 0;
  private missingOrderCount = 0;

  /**
   * Eine Bestellung, die zählt.
   *
   * DER UMSATZ WIRD NICHT ÜBERGEBEN — er wird erst bei summary() gebraucht
   * und kommt dort aus der bestehenden Umsatzsumme. Diese Klasse führt keine
   * zweite Umsatzzählung; es gibt im ganzen System genau eine, und das ist
   * die des Tagesüberblicks.
   *
   * DIE MENGE ZÄHLT MIT. Kosten sind `unitCost × quantity` — drei Bleche
   * kosten das Dreifache eines Blechs. Eine Kostensumme, die die Menge
   * unterschlägt, ist bei kleinen Bestellungen plausibel und bei großen
   * grotesk falsch.
   */
  addOrder(items: readonly CostItem[]): void {
    this.orderCount += 1;
    let fehltHier = false;

    for (const item of items) {
      this.itemCount += 1;

      if (item.unitCostCents === null) {
        /**
         * KEINE 0 UND KEIN ÜBERSPRINGEN MIT ANDERER WIRKUNG: Die Position
         * wird gezählt, ihr Kostenanteil bleibt ungenannt, und der ganze
         * Zeitraum verliert seine Vollständigkeit. Genau diese drei Dinge
         * zugleich sind die ehrliche Antwort auf „unbekannt".
         */
        this.missingItemCount += 1;
        fehltHier = true;
        continue;
      }

      this.knownCostCents += item.unitCostCents * item.quantity;
    }

    if (fehltHier) {
      this.missingOrderCount += 1;
    }
  }

  /**
   * Eine bereits fertige Zusammenfassung dazurechnen — der Weg, auf dem aus
   * sieben Tagen eine Woche wird.
   *
   * ES WERDEN AUSSCHLIESSLICH DIE ROHEN ZÄHLER ADDIERT. `complete`,
   * `grossProfitCents` und `marginTenthsPercent` der Teile werden NICHT
   * angefasst, sondern für das Ganze neu gebildet. Eine Woche, deren Marge
   * aus den Tagesmargen entstünde, wäre ein ungewichteter Mittelwert — und
   * ein Montag mit 40 € Umsatz und 70 % Marge zöge eine Woche nach oben, in
   * der am Samstag 900 € mit 45 % standen.
   *
   * Der Umsatz wird auch hier NICHT mitgenommen; er kommt bei summary() aus
   * der Wochensumme, die ohnehin schon gebildet wird.
   */
  addSummary(other: CostSummary): void {
    this.knownCostCents += other.knownCostCents;
    this.itemCount += other.itemCount;
    this.missingItemCount += other.missingItemCount;
    this.orderCount += other.orderCount;
    this.missingOrderCount += other.missingOrderCount;
  }

  /**
   * Die Zusammenfassung — mit dem Umsatz, der anderswo bereits gezählt wurde.
   *
   * DASS DER UMSATZ HEREINKOMMT, IST DIE WICHTIGSTE ENTSCHEIDUNG DIESER
   * DATEI. Die bestehende Umsatzkennzahl bleibt die einzige Quelle; der
   * Rohertrag ist eine Rechnung MIT ihr und nicht daneben. Eine Marge, die
   * sich auf einen selbst gezählten Umsatz bezöge, könnte der Zahl
   * widersprechen, die drei Zentimeter darüber auf demselben Bildschirm
   * steht.
   */
  summary(revenueCents: number): CostSummary {
    const complete = this.missingItemCount === 0;
    const grossProfitCents = complete ? revenueCents - this.knownCostCents : null;

    return {
      revenueCents,
      knownCostCents: this.knownCostCents,
      itemCount: this.itemCount,
      missingItemCount: this.missingItemCount,
      orderCount: this.orderCount,
      missingOrderCount: this.missingOrderCount,
      complete,
      grossProfitCents,
      marginTenthsPercent:
        grossProfitCents === null || revenueCents === 0
          ? null
          : zehntelProzent(grossProfitCents, revenueCents),
    };
  }
}

/**
 * Zehntel Prozent, kaufmännisch gerundet und symmetrisch um die Null.
 *
 * Math.round() allein rundet .5 immer NACH OBEN — also -20,55 % auf -20,5 %
 * und +20,55 % auf +20,6 %. Diese Unwucht wäre in einer Auswertung, die
 * ausdrücklich negative Margen zulässt, eine kleine systematische
 * Schönfärbung. Der Betrag wird deshalb gerundet und das Vorzeichen danach
 * wieder angesetzt.
 *
 * Die Multiplikation vor der Division ist Absicht: `(gewinn * 1000) / umsatz`
 * bleibt bis 9.999.999.999 Cent Rohertrag weit innerhalb des sicheren
 * Zahlenbereichs, und es entsteht kein Zwischenwert, der schon gerundet wäre.
 *
 * Die -0 wird ausdrücklich zu 0: Sie käme bei einem winzigen Verlust heraus,
 * der auf 0,0 % rundet, und „-0,0 %" ist keine Zahl, die jemand lesen will.
 */
function zehntelProzent(grossProfitCents: number, revenueCents: number): number {
  const zehntel = (grossProfitCents * 1000) / revenueCents;
  const gerundet = Math.round(Math.abs(zehntel));
  if (gerundet === 0) return 0;
  return zehntel < 0 ? -gerundet : gerundet;
}
