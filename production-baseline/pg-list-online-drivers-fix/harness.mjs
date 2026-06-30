// Standalone logic harness for the patched pgListOnlineDrivers() mapping.
// Proves the row -> response-object mapping (incl. the bike -> "2w" rule)
// without needing to boot the full production bundle / firebase-admin.
//
//   node harness.mjs
//
// This mirrors the NEW_BODY mapping in apply-patch.py exactly. If you change one,
// change the other.

function mapRow(r) {
  const isBike = r.vehicle_id === "bike";
  return {
    id: r.driver_uid,
    driverUid: r.driver_uid,
    lat: r.lat,
    lng: r.lng,
    accuracy: r.accuracy,
    isOnline: r.is_online,
    vehicleId: r.vehicle_id,
    vehicleName: r.vehicle_name,
    verificationStatus: r.verification_status,
    accountStatus: r.account_status,
    vehicleProductId: isBike ? "2w" : r.vehicle_id,
    vehicleSlug: isBike ? "2w" : r.vehicle_id,
    vehicleType: isBike ? "2w" : r.vehicle_name,
  };
}

const rows = [
  { driver_uid: "u_bike", lat: 12.9, lng: 77.6, accuracy: 5, is_online: true, vehicle_id: "bike", vehicle_name: "Honda Activa", verification_status: "verified", account_status: "active" },
  { driver_uid: "u_truck", lat: 13.0, lng: 77.7, accuracy: 8, is_online: true, vehicle_id: "truck", vehicle_name: "Tata Ace", verification_status: "pending", account_status: "active" },
];

const out = rows.map(mapRow);
console.log(JSON.stringify(out, null, 2));

const [bike, truck] = out;
const ok =
  bike.vehicleProductId === "2w" && bike.vehicleSlug === "2w" && bike.vehicleType === "2w" &&
  bike.vehicleId === "bike" && bike.vehicleName === "Honda Activa" &&
  bike.id === "u_bike" && bike.isOnline === true &&
  bike.verificationStatus === "verified" && bike.accountStatus === "active" &&
  truck.vehicleProductId === "truck" && truck.vehicleSlug === "truck" &&
  truck.vehicleType === "Tata Ace" &&
  truck.lat === 13.0 && truck.lng === 77.7 && truck.accuracy === 8;

console.log("\nASSERT shape+mapping:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
