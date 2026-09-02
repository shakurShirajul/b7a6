import express, { Application } from "express";
import { userRoutes } from "./modules/user/user.routes";


const app: Application = express();

app.use(express.json());

app.use("/api/v1", userRoutes);
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

export default app;