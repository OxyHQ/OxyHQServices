import { Request, Response } from 'express';
import { z } from 'zod';

// Validation schemas
const paymentMethodSchema = z.object({
  type: z.enum(['card', 'applePay', 'googlePay']),
  cardNumber: z.string().optional(),
  expiryMonth: z.string().optional(),
  expiryYear: z.string().optional(),
  cvc: z.string().optional(),
  token: z.string().optional(),
});

const processPaymentSchema = z.object({
  userId: z.string(),
  plan: z.string(),
  paymentMethod: paymentMethodSchema,
  platform: z.string(),
});

export const processPayment = async (req: Request, res: Response) => {
  try {
    const paymentData = processPaymentSchema.parse(req.body);

    // TODO: Integrate with actual payment processor (Stripe, etc.)
    // This is a mock implementation
    const success = Math.random() > 0.1; // 90% success rate for testing

    if (success) {
      res.json({
        success: true,
        transactionId: `trans_${Date.now()}`,
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Payment processing failed',
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid payment data', errors: error.errors });
    } else {
      res.status(500).json({ message: 'Payment processing failed', error });
    }
  }
};

export const validatePaymentMethod = async (req: Request, res: Response) => {
  try {
    const { paymentMethod } = req.body;
    const validatedPaymentMethod = paymentMethodSchema.parse(paymentMethod);

    // TODO: Integrate with payment processor for actual validation
    // This is a mock implementation
    const isValid = validatedPaymentMethod.type === 'card' ? 
      isValidCard(validatedPaymentMethod) : 
      Math.random() > 0.1;

    res.json({ valid: isValid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ message: 'Invalid payment method data', errors: error.errors });
    } else {
      res.status(500).json({ message: 'Validation failed', error });
    }
  }
};

export const getPaymentMethods = async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // TODO: Integrate with payment processor to get saved payment methods
    // This is a mock implementation
    res.json({
      methods: []
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch payment methods', error });
  }
};

// Helper function for basic card validation
function isValidCard(paymentMethod: z.infer<typeof paymentMethodSchema>) {
  if (!paymentMethod.cardNumber || !paymentMethod.expiryMonth || !paymentMethod.expiryYear || !paymentMethod.cvc) {
    return false;
  }

  // Basic Luhn algorithm check for card number
  const number = paymentMethod.cardNumber.replace(/\D/g, '');
  let sum = 0;
  let isEven = false;

  for (let i = number.length - 1; i >= 0; i--) {
    let digit = parseInt(number[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  // Check expiry date
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear() % 100;
  const currentMonth = currentDate.getMonth() + 1;
  const expYear = parseInt(paymentMethod.expiryYear, 10);
  const expMonth = parseInt(paymentMethod.expiryMonth, 10);

  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    return false;
  }

  // Check CVC
  const cvc = paymentMethod.cvc.replace(/\D/g, '');
  if (cvc.length < 3 || cvc.length > 4) {
    return false;
  }

  return sum % 10 === 0;
}