declare module 'javascript-lp-solver' {
  interface LPModel {
    optimize: string;
    opType: 'min' | 'max';
    constraints: Record<string, { equal?: number; min?: number; max?: number }>;
    variables: Record<string, Record<string, number>>;
    ints?: Record<string, number>;
    bounds?: Record<string, { min?: number; max?: number }>;
  }

  interface LPResult {
    feasible: boolean;
    result: number;
    bounded?: boolean;
    [key: string]: any;
  }

  export function Solve(model: LPModel): LPResult;

  const solver: {
    Solve: (model: LPModel) => LPResult;
  };

  export default solver;
}
