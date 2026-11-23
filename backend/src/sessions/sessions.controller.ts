import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { FlightInput } from '@paper-plane/game-math';
import { LaunchInputPipe } from './launch-input.pipe.js';
import { SessionsService } from './sessions.service.js';

@Controller('sessions')
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Post()
  create() {
    return this.sessions.createSession();
  }

  @Post(':sessionId/attempts')
  launch(
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @Body(LaunchInputPipe) input: FlightInput,
  ) {
    return this.sessions.createAttempt(sessionId, input);
  }

  @Get(':sessionId/attempts')
  history(@Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string) {
    return this.sessions.getAttempts(sessionId);
  }
}
