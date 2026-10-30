// Next.js App Router: app/api/stripe/webhook/route.ts
// A verified Stripe webhook. Without constructEvent, anyone can POST a fake "payment succeeded".
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text(); // raw body is required for signature verification
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      // Look up the user by event.data.object.customer and update their plan here.
      // Make this idempotent: Stripe can send the same event more than once.
      break;
  }
  return Response.json({ received: true });
}
