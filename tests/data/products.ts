export type ProductRow = {
  /** Suffix used in the data-test attribute, e.g. add-to-cart-<slug>. */
  slug: string;
  name: string;
};

export const products: ProductRow[] = [
  { slug: "sauce-labs-backpack", name: "Sauce Labs Backpack" },
  { slug: "sauce-labs-bike-light", name: "Sauce Labs Bike Light" },
  { slug: "sauce-labs-bolt-t-shirt", name: "Sauce Labs Bolt T-Shirt" },
  { slug: "sauce-labs-fleece-jacket", name: "Sauce Labs Fleece Jacket" },
  { slug: "sauce-labs-onesie", name: "Sauce Labs Onesie" },
  {
    slug: "test.allthethings()-t-shirt-(red)",
    name: "Test.allTheThings() T-Shirt (Red)",
  },
];
