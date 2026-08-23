<?php
declare(strict_types=1);

use Buschmann\OrderSystem\Orders\OrderStatus;
use Tests\Assert;

final class OrderStatusTest
{
    public function testThereAreExactlyFiveStates(): void
    {
        Assert::count(5, OrderStatus::cases(), 'Statuswerte');
        Assert::same('new', OrderStatus::New->value, 'neu');
        Assert::same('confirmed', OrderStatus::Confirmed->value, 'bestätigt');
        Assert::same('in_production', OrderStatus::InProduction->value, 'in Produktion');
        Assert::same('completed', OrderStatus::Completed->value, 'abgeschlossen');
        Assert::same('cancelled', OrderStatus::Cancelled->value, 'storniert');
    }

    /** Regel 5: Ein unbekannter Status ist ungültig. */
    public function testUnknownValueIsRejected(): void
    {
        Assert::throws(\ValueError::class,
            static fn () => OrderStatus::from('geliefert'), 'unbekannter Status');
        Assert::null(OrderStatus::tryFrom('offen'), 'tryFrom liefert null');
        Assert::null(OrderStatus::tryFrom(''), 'leerer Status');
    }

    public function testTheNormalPathIsAllowed(): void
    {
        Assert::true(OrderStatus::New->canTransitionTo(OrderStatus::Confirmed), 'neu -> bestätigt');
        Assert::true(OrderStatus::Confirmed->canTransitionTo(OrderStatus::InProduction), 'bestätigt -> Produktion');
        Assert::true(OrderStatus::InProduction->canTransitionTo(OrderStatus::Completed), 'Produktion -> abgeschlossen');
    }

    public function testCancellingIsPossibleUntilCompletion(): void
    {
        foreach ([OrderStatus::New, OrderStatus::Confirmed, OrderStatus::InProduction] as $from) {
            Assert::true($from->canTransitionTo(OrderStatus::Cancelled), $from->value . ' -> storniert');
        }
    }

    /** Kein Rückwärtsgang: Das wäre Datenkorruption, keine Korrektur. */
    public function testFinishedOrdersCannotBeReopened(): void
    {
        foreach (OrderStatus::cases() as $target) {
            Assert::false(OrderStatus::Completed->canTransitionTo($target),
                'abgeschlossen -> ' . $target->value);
            Assert::false(OrderStatus::Cancelled->canTransitionTo($target),
                'storniert -> ' . $target->value);
        }
    }

    public function testStepsCannotBeSkippedOrReversed(): void
    {
        Assert::false(OrderStatus::New->canTransitionTo(OrderStatus::Completed), 'neu -> abgeschlossen');
        Assert::false(OrderStatus::New->canTransitionTo(OrderStatus::InProduction), 'neu -> Produktion');
        Assert::false(OrderStatus::InProduction->canTransitionTo(OrderStatus::Confirmed), 'Produktion -> bestätigt');
        Assert::false(OrderStatus::Confirmed->canTransitionTo(OrderStatus::New), 'bestätigt -> neu');
    }

    public function testAStatusIsNeverATransitionToItself(): void
    {
        foreach (OrderStatus::cases() as $status) {
            Assert::false($status->canTransitionTo($status), $status->value . ' -> sich selbst');
        }
    }

    public function testKnowsItsFinalStates(): void
    {
        Assert::true(OrderStatus::Completed->isFinal(), 'abgeschlossen ist final');
        Assert::true(OrderStatus::Cancelled->isFinal(), 'storniert ist final');
        Assert::false(OrderStatus::New->isFinal(), 'neu ist nicht final');
    }

    public function testEachStateHasAGermanLabel(): void
    {
        Assert::same('Neu', OrderStatus::New->label(), 'Label neu');
        Assert::same('In Produktion', OrderStatus::InProduction->label(), 'Label Produktion');
    }
}
