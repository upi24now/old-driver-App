import { Router, type IRouter } from "express";
import healthRouter        from "./health";
import authRouter          from "./auth";
import driverPlansRouter   from "./driver-plans";
import driversRouter       from "./drivers";
import driverProfileRouter from "./driver-profile";
import ordersRouter        from "./orders";
import walletRouter        from "./wallet";
import payoutsRouter       from "./payouts";
import supportRouter       from "./support";
import devRouter           from "./dev";
import kycUploadRouter     from "./kyc-upload";
import kycAdminRouter      from "./kyc-admin";
import adminAuthRouter     from "./admin-auth";
import adminUsersRouter    from "./admin-users";
import adminDataRouter     from "./admin-data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(driverPlansRouter);
router.use(driversRouter);
router.use(driverProfileRouter);
router.use(ordersRouter);
router.use(walletRouter);
router.use(payoutsRouter);
router.use(supportRouter);
router.use(devRouter);
router.use(kycUploadRouter);
router.use(kycAdminRouter);
router.use(adminAuthRouter);
router.use(adminUsersRouter);
router.use(adminDataRouter);

export default router;
