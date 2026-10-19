import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";

// Raw indexed data for debugging and internal tools. The public API lives in backend/.
const app = new Hono();
app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));
export default app;
