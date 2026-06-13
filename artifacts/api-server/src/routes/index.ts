import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import driverPlansRouter from "./driver-plans";
import driversRouter from "./drivers";
import ordersRouter from "./orders";
import walletRouter from "./wallet";
import payoutsRouter from "./payouts";
import devRouter from "./dev";
import kycUploadRouter from "./kyc-upload";
import kycAdminRouter from "./kyc-admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(driverPlansRouter);
router.use(driversRouter);
router.use(ordersRouter);
router.use(walletRouter);
router.use(payoutsRouter);
router.use(devRouter);
router.use(kycUploadRouter);
router.use(kycAdminRouter);

export default router;
