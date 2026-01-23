// src/repositories/baseRepository.js
class BaseRepository {
  constructor(model) {
    this.model = model;
  }

  async create(data) {
    return await this.model.create(data);
  }

  async findById(id) {
    return await this.model.findById(id);
  }

  async update(id, data) {
    return await this.model.update(id, data);
  }

  async delete(id) {
    // Soft delete implementation
    return await this.model.update(id, { deleted_at: new Date() });
  }
}

module.exports = BaseRepository;