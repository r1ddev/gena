import { describe, expect, it } from "vitest";
import { parseOzonPayoutStatement } from "./payouts";

describe("parseOzonPayoutStatement", () => {
  it("выделяет категории выплаты и подробности услуг из ответа Ozon", () => {
    const result = parseOzonPayoutStatement({
      cashFlows: [{
        currency_code: "RUB",
        orders_amount: 1800,
        returns_amount: -250,
        commission_amount: -100,
        item_delivery_and_return_amount: -50,
        services_amount: -20,
      }],
      details: {
        begin_balance_amount: 300,
        end_balance_amount: 1680,
        loan: -12,
        invoice_transfer: 7,
        rfbs: {
          total: -9,
          transfer_delivery: -5,
          transfer_delivery_return: -2,
          compensation_delivery_return: 3,
          partial_compensation: -4,
          partial_compensation_return: -1,
        },
        services: {
          total: -20,
          items: [{ name: "Продвижение", price: -12 }, { name: "Хранение", price: -8 }],
        },
      },
    }, "RUB");

    expect(result.categories).toEqual([
      { key: "orders_amount", label: "Продажи", amount: 1800 },
      { key: "returns_amount", label: "Возвраты", amount: -250 },
      { key: "commission_amount", label: "Комиссия Ozon", amount: -100 },
      { key: "item_delivery_and_return_amount", label: "Доставка и возвраты", amount: -50 },
      { key: "services_amount", label: "Услуги Ozon", amount: -20 },
    ]);
    expect(result.serviceGroups).toEqual([{
      key: "services",
      label: "Услуги Ozon",
      total: -20,
      items: [
        { label: "Продвижение", amount: -12 },
        { label: "Хранение", amount: -8 },
      ],
    }, {
      key: "loan",
      label: "Перевод по займу",
      total: -12,
      items: [],
    }, {
      key: "invoice_transfer",
      label: "Перевод по счёту",
      total: 7,
      items: [],
    }, {
      key: "rfbs",
      label: "Доставка продавцом",
      total: -9,
      items: [
        { label: "Доставка покупателю", amount: -5 },
        { label: "Возврат доставки", amount: -2 },
        { label: "Компенсация доставки при возврате", amount: 3 },
        { label: "Частичная компенсация", amount: -4 },
        { label: "Возврат частичной компенсации", amount: -1 },
      ],
    }]);
    expect(result.beginBalance).toBe(300);
    expect(result.endBalance).toBe(1680);
  });

  it("не смешивает категории выплат в разных валютах", () => {
    const result = parseOzonPayoutStatement({
      cashFlows: [
        { currency_code: "RUB", orders_amount: 100 },
        { currency_code: "USD", orders_amount: 20 },
      ],
      details: {},
    }, "RUB");

    expect(result.categories).toEqual([{ key: "orders_amount", label: "Продажи", amount: 100 }]);
  });

  it("переводит коды услуг из отчёта Ozon в понятные названия", () => {
    const result = parseOzonPayoutStatement({
      details: {
        others: {
          total: -5,
          items: [
            { name: "MarketplaceServiceItemCrossdocking", price: -5 },
            { name: "UnknownMachineCode", price: 0 },
          ],
        },
      },
    });

    expect(result.serviceGroups).toEqual([{
      key: "others",
      label: "Другие операции",
      total: -5,
      items: [
        { label: "Кросс-докинг", amount: -5 },
        { label: "Прочая услуга Ozon", amount: 0 },
      ],
    }]);
  });

  it("возвращает пустую расшифровку для старых записей без сохранённых деталей", () => {
    expect(parseOzonPayoutStatement({ period: { id: "123" }, payments: [] }, "RUB")).toEqual({
      categories: [],
      serviceGroups: [],
      beginBalance: null,
      endBalance: null,
    });
  });
});
