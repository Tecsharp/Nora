declare module 'fast-formula-parser' {
  export default class FormulaParser {
    constructor(config: unknown)
    parse(formula: string, position: { sheet: string; row: number; col: number }): unknown
    static FormulaError: new (error: string, msg?: string) => { error: string }
  }
}
