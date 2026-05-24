export type CustomerRow = {
  firstName: string;
  lastName: string;
  postalCode: string;
};

export const customers: CustomerRow[] = [
  { firstName: "Test", lastName: "User", postalCode: "12345" },
  { firstName: "Jane", lastName: "Doe", postalCode: "90210" },
  { firstName: "Alex", lastName: "Nguyen", postalCode: "70000" },
];
