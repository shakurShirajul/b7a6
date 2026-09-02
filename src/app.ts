import express, { Application } from "express";
import { userRoutes } from "./modules/user/user.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { profileRoutes } from "./modules/profile/profile.routes";


const app: Application = express();

app.use(express.json());

app.use("/api/v1", userRoutes);
app.use("/api/v1", authRoutes);
app.use("/api/v1", profileRoutes);
app.get("/", (req, res) => {
  res.send("Hello, World!");
});

export default app;