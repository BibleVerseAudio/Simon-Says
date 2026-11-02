/**
 * Command pools: single source of truth for enrollment + gameplay draws.
 * Extracted so the pose library enrollment list can never drift from the
 * game draw pool (handoff §11.6). GameScreen imports from here.
 */
export type Voice = 'female' | 'male';

export const UPPER_BODY_COMMANDS = [
  'touch_your_shoulders',
  'touch_your_head',
  'touch_your_right_ear',
  'touch_your_left_ear',
  'touch_your_nose',
  'touch_your_chin',
  'clap_your_hands',
  'wave_your_right_hand',
  'wave_your_left_hand',
  'raise_both_hands',
  'cross_your_arms',
  'make_a_fist',
  'touch_your_cheeks',
  'cover_your_eyes',
  'cover_your_mouth',
  'point_at_the_camera',
  'give_a_thumbs_up',
  'touch_your_forehead',
  'make_an_x_sign',
  'shrug_your_shoulders',
] as const;

export const LOWER_BODY_COMMANDS = [
  'lift_your_right_knee',
  'lift_your_left_knee',
  'march_in_place',
  'do_a_squat',
  'touch_your_toes',
  'step_to_the_right',
  'step_to_the_left',
  'step_forward',
  'step_backward',
  'jump_once',
  'spin_around',
  'stomp_your_right_foot',
  'stomp_your_left_foot',
  'stand_on_your_right_leg',
  'stand_on_your_left_leg',
  'bend_your_knees',
  'twist_your_hips',
  'kick_your_right_leg',
  'kick_your_left_leg',
  'take_two_steps_back',
] as const;

export const BOOTCAMP_COMMANDS = [
  'lie_on_your_back',
  'sit_up',
  'get_into_pushup_position',
  'do_a_pushup',
  'hold_a_plank',
  'do_jumping_jacks',
  'do_a_burpee',
  'do_mountain_climbers',
  'sit_down_and_stand_up',
  'lie_down_and_jump_up',
  'kneel_down',
  'stand_up_tall',
] as const;

export const KIDS_COMMANDS = [
  'clap_your_hands',
  'wave_your_right_hand',
  'wave_your_left_hand',
  'raise_both_hands',
  'give_a_thumbs_up',
  'jump_once',
  'spin_around',
  'march_in_place',
] as const;

export function poolFor(voice: Voice, mode?: string): readonly string[] {
  if (mode === 'bootcamp') return BOOTCAMP_COMMANDS as readonly string[];
  if (mode === 'kids') return KIDS_COMMANDS as readonly string[];
  return voice === 'female'
    ? (UPPER_BODY_COMMANDS as readonly string[])
    : ([...UPPER_BODY_COMMANDS, ...LOWER_BODY_COMMANDS] as readonly string[]);
}
