export async function sendPushNotification(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<{ successCount: number; failureCount: number }> {
  if (!tokens || tokens.length === 0) {
    return { successCount: 0, failureCount: 0 };
  }

  const messages = tokens.map((token) => ({
    to: token,
    sound: 'default',
    priority: 'high',
    badge: 1,
    title,
    body,
    _contentAvailable: true,
    interruptionLevel: 'active',
    data: { source: 'gcp', ...(data || {}) },
  }));

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      return { successCount: 0, failureCount: tokens.length };
    }

    const resData: any = await res.json();
    let successCount = 0;
    let failureCount = 0;

    if (Array.isArray(resData?.data)) {
      for (const item of resData.data) {
        if (item?.status === 'ok') successCount++;
        else failureCount++;
      }
    }

    return { successCount, failureCount };
  } catch (err) {
    return { successCount: 0, failureCount: tokens.length };
  }
}
