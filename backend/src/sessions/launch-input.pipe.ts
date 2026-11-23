import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { isPlaneId, validateLaunch } from '@paper-plane/game-math';
import type { FlightInput } from '@paper-plane/game-math';

@Injectable()
export class LaunchInputPipe implements PipeTransform<unknown, FlightInput> {
  transform(value: unknown): FlightInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Expected a launch object');
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some(key => !['planeId', 'angle', 'speed'].includes(key))) {
      throw new BadRequestException('Only planeId, angle and speed are accepted');
    }
    const { planeId, angle, speed } = body;
    if (!isPlaneId(planeId) || typeof angle !== 'number' || typeof speed !== 'number') {
      throw new BadRequestException('Valid planeId and numeric angle and speed are required');
    }
    try {
      validateLaunch(planeId, angle, speed);
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException(error.message);
      throw error;
    }
    return { planeId, angle, speed };
  }
}
