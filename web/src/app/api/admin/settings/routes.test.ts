// Node's test glob treats square brackets as a pattern, so import the dynamic-segment
// contract from a stable parent path to ensure it runs in the repository-wide suite.
import "./[key]/route.test.ts";
