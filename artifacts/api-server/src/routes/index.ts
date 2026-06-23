import { Router, type IRouter } from "express";
import healthRouter from "./health";
import coachRouter from "./coach";
import openrouterRouter from "./openrouter";

const router: IRouter = Router();

router.use(healthRouter);
router.use(coachRouter);
router.use(openrouterRouter);

export default router;
