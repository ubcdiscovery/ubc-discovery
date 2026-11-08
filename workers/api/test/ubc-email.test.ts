import { describe, expect, it } from "vite-plus/test";
import { isUbcEmail } from "../src/schemas/member";

describe("UBC trust-badge domain boundary", () => {
  it("accepts only ubc.ca and its real subdomains", () => {
    for (const address of ["member@ubc.ca", "member@STUDENT.UBC.CA", "member@a.b.ubc.ca"])
      expect(isUbcEmail(address)).toBe(true);
    for (const address of ["member@example.com", "member@evilubc.ca", "member@ubc.ca.example.com"])
      expect(isUbcEmail(address)).toBe(false);
  });
});
