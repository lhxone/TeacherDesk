export type ErrorDetail = { field?: string; message: string };

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: ErrorDetail[];

  constructor(statusCode: number, code: string, message: string, details?: ErrorDetail[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static validation(message = '请求参数校验失败', details?: ErrorDetail[]) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }
  static unauthenticated(message = '未登录或登录已过期') {
    return new ApiError(401, 'UNAUTHENTICATED', message);
  }
  /**
   * Used for both "not yours" and "does not exist" on owned resources, so that
   * IDs cannot be probed for existence. See API.md §0.2.
   */
  static forbidden(message = '无权访问该资源') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = '资源不存在') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: ErrorDetail[]) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  static businessRule(message: string, details?: ErrorDetail[]) {
    return new ApiError(422, 'BUSINESS_RULE_VIOLATION', message, details);
  }
  static rateLimited(message = '请求过于频繁，请稍后再试') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
}
