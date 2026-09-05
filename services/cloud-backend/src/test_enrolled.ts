import { getEnrolledActiveUsers } from './services/firestore';

async function main() {
  const users = await getEnrolledActiveUsers();
  console.log('=== ENROLLED ACTIVE USERS COUNT ===:', users.length);
  users.forEach((u) => {
    console.log(`- User: ${u.userId}`);
    console.log(`  State: ${u.state}, cloudTradingEnabled: ${u.cloudTradingEnabled}`);
    console.log(`  pushTokens:`, u.pushTokens);
    console.log(`  fcmTokens:`, u.fcmTokens);
  });
}

main().catch(console.error);
