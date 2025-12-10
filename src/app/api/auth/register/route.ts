import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { webAuthnService } from '@/lib/webauthn';
import { cryptoUtils } from '@/lib/crypto';

export async function POST(request: NextRequest) {
  try {
    console.log('Registration request received');
    
    const { email, name } = await request.json();
    console.log('Registration data:', { email, name: name ? '[PROVIDED]' : '[NOT PROVIDED]' });

    if (!email) {
      console.log('Registration failed: Email is required');
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if user already exists
    console.log('Checking if user exists:', email);
    const existingUser = await db.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log('Registration failed: User already exists:', email);
      return NextResponse.json(
        { error: 'User already exists' },
        { status: 400 }
      );
    }

    // Create user in database
    console.log('Creating new user:', email);
    const user = await db.user.create({
      data: {
        email,
        name,
      },
    });
    console.log('User created successfully:', user.id);

    // Generate E2E encryption key pair
    console.log('Generating E2E encryption keys...');
    const e2eKeyPair = cryptoUtils.generateKeyPair();
    console.log('E2E keys generated successfully');

    // Update user with E2E keys
    console.log('Updating user with E2E keys...');
    await db.user.update({
      where: { id: user.id },
      data: {
        e2ePublicKey: e2eKeyPair.publicKey,
        e2ePrivateKey: e2eKeyPair.privateKey,
      },
    });
    console.log('User updated with E2E keys successfully');

    // Generate passkey registration options
    console.log('Generating WebAuthn registration options...');
    const options = webAuthnService.generateRegistrationOptions({
      id: user.id,
      email: user.email,
      name: user.name,
    });
    console.log('WebAuthn options generated successfully');

    // Store challenge in session or temporary storage
    // For now, we'll use a simple approach (in production, use Redis)
    const challenge = options.challenge;
    
    console.log('Registration initialization successful for user:', user.id);
    return NextResponse.json({
      options: options,
      userId: user.id,
      challenge: challenge,
    });
  } catch (error) {
    console.error('Registration start error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error: error
    });
    
    // Return more specific error information in development
    const isDevelopment = process.env.NODE_ENV === 'development';
    return NextResponse.json(
      {
        error: 'Internal server error',
        ...(isDevelopment && {
          details: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined
        })
      },
      { status: 500 }
    );
  }
}