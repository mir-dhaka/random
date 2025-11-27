/**
 * =============================================================================
 * IDb.js – Lightweight IndexedDB Utility
 * =============================================================================
 *
 * Overview:
 * ---------
 * IDb.js provides a simplified wrapper around the browser's IndexedDB API
 * with support for multiple named databases, singleton access, and idempotent
 * bucket creation. It is designed to mimic typical AJAX-style CRUD operations
 * via the companion IDbUtil class.
 *
 * Features:
 * ---------
 * 1. Multiple named databases with singleton access:
 *      - IDbUtil.getInstance("DB_NAME") ensures one instance per database.
 *
 * 2. Idempotent bucket initialization:
 *      - init(["bucket1","bucket2"]) creates buckets if they do not exist.
 *
 * 3. Full CRUD support with nested object filtering:
 *      - insert(bucket, data), get(bucket,id), update(bucket,data), delete(bucket,id)
 *      - filter(bucket, { "nested.field": value }) for querying nested objects.
 *
 * 4. Transactions across multiple buckets:
 *      - transaction(["bucket1","bucket2"], callback)
 *
 * 5. Data portability:
 *      - dump(buckets) → JSON string
 *      - import(jsonData) → populate multiple buckets from JSON
 *
 * 6. Bucket management:
 *      - listBuckets() → array of existing buckets
 *      - deleteBucket(bucket) → safely remove a bucket
 *
 * Companion Utility (IDbUtil):
 * -----------------------------
 * IDbUtil extends IDb and provides API-like asynchronous methods with callbacks:
 * - getMany(bucket, filter, callback)
 * - createData(bucket, data, callback)
 * - updateData(bucket, data, callback)
 * - deleteData(bucket, id, callback)
 * - dumpBuckets(buckets)
 * - importBuckets(jsonData)
 *
 * Example Usage:
 * --------------
 * const dbA = IDbUtil.getInstance("DB_A");
 * await dbA.init(["employee","department","project"]);
 *
 * await dbA.createData("employee", { name: "Alice", address: { city: "London" } }, res => console.log(res));
 *
 * dbA.getMany("employee", { "address.city": "London" }, res => console.log("London employees:", res));
 *
 * Notes:
 * ------
 * - Nested fields are queried using dot notation: "address.city"
 * - Multiple databases are isolated; each database maintains its own buckets.
 * - All operations are asynchronous and promise-based.
 *
 * Author: Your Name
 * License: MIT
 * =============================================================================
 */

class IDb {
    static instances = {}; // singleton map per dbName

    constructor(dbName = "LSDB_IDB", version = 1) {
        if (IDb.instances[dbName]) return IDb.instances[dbName];

        this.dbName = dbName;
        this.version = version;
        this.db = null;

        IDb.instances[dbName] = this;
    }

    static getInstance(dbName, version = 1) {
        if (!IDb.instances[dbName]) {
            IDb.instances[dbName] = new IDb(dbName, version);
        }
        return IDb.instances[dbName];
    }

    async init(buckets = []) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                buckets.forEach(bucket => {
                    if (!db.objectStoreNames.contains(bucket)) {
                        db.createObjectStore(bucket, { keyPath: "id", autoIncrement: true });
                    }
                });
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => reject(event.target.error);
        });
    }

    getStore(bucket, mode = "readonly") {
        if (!this.db.objectStoreNames.contains(bucket)) {
            throw new Error(`Bucket '${bucket}' does not exist`);
        }
        const tx = this.db.transaction(bucket, mode);
        return tx.objectStore(bucket);
    }

    async insert(bucket, data) {
        const store = this.db.objectStoreNames.contains(bucket)
            ? this.getStore(bucket, "readwrite")
            : (await this.init([bucket])).transaction(bucket, "readwrite").objectStore(bucket);

        return new Promise((resolve, reject) => {
            const req = store.add(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async getAll(bucket) {
        const store = this.getStore(bucket);
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async get(bucket, id) {
        const store = this.getStore(bucket);
        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async update(bucket, data) {
        const store = this.getStore(bucket, "readwrite");
        return new Promise((resolve, reject) => {
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async delete(bucket, id) {
        const store = this.getStore(bucket, "readwrite");
        return new Promise((resolve, reject) => {
            const req = store.delete(id);
            req.onsuccess = () => resolve(true);
            req.onerror = () => reject(req.error);
        });
    }

    async filter(bucket, filterObj) {
        const all = await this.getAll(bucket);
        return all.filter(item => {
            return Object.keys(filterObj).every(key => {
                const val = key.split('.').reduce((o, k) => o ? o[k] : undefined, item);
                return val == filterObj[key];
            });
        });
    }

    async transaction(buckets, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(buckets, "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);

            const stores = {};
            buckets.forEach(b => stores[b] = tx.objectStore(b));

            try {
                callback(stores);
            } catch (err) {
                reject(err);
            }
        });
    }

    async dump(buckets) {
        const result = {};
        for (let bucket of buckets) {
            result[bucket] = await this.getAll(bucket);
        }
        return JSON.stringify(result, null, 2);
    }

    async import(jsonData) {
        const obj = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
        for (let bucket in obj) {
            if (!this.db.objectStoreNames.contains(bucket)) {
                await this.init([bucket]); // create missing bucket
            }
            const store = this.getStore(bucket, "readwrite");
            for (let item of obj[bucket]) store.put(item);
        }
    }

    listBuckets() {
        return Array.from(this.db.objectStoreNames);
    }

    async deleteBucket(bucket) {
        if (!this.db.objectStoreNames.contains(bucket)) return;
        const version = this.db.version + 1;
        this.db.close();
        const request = indexedDB.open(this.dbName, version);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (db.objectStoreNames.contains(bucket)) db.deleteObjectStore(bucket);
        };
        return new Promise((resolve, reject) => {
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(true);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

class IDbUtil extends IDb {
    constructor(dbName = "LSDB_IDB") {
        super(dbName);
    }

    async getMany(bucket, filter = {}, callback) {
        try {
            let results = await this.getAll(bucket);
            if (filter && Object.keys(filter).length > 0) {
                results = results.filter(item => {
                    return Object.keys(filter).every(key => {
                        const val = key.split('.').reduce((o, k) => o ? o[k] : undefined, item);
                        return val == filter[key];
                    });
                });
            }
            setTimeout(() => callback(results), 200);
        } catch (err) {
            console.error("IDbUtil GET error:", err);
        }
    }

    async createData(bucket, data, callback) {
        try {
            const id = await this.insert(bucket, data);
            const inserted = await this.get(bucket, id);
            setTimeout(() => callback(inserted), 200);
        } catch (err) {
            console.error("IDbUtil CREATE error:", err);
        }
    }

    async updateData(bucket, data, callback) {
        try {
            await this.update(bucket, data);
            const updated = await this.get(bucket, data.id);
            setTimeout(() => callback(updated), 200);
        } catch (err) {
            console.error("IDbUtil UPDATE error:", err);
        }
    }

    async deleteData(bucket, id, callback) {
        try {
            await this.delete(bucket, id);
            setTimeout(() => callback(true), 200);
        } catch (err) {
            console.error("IDbUtil DELETE error:", err);
        }
    }

    async dumpBuckets(buckets) {
        return await this.dump(buckets);
    }

    async importBuckets(jsonData) {
        await this.import(jsonData);
    }
}

class IDbUtilExample {
    static async run() {
        const dbA = IDbUtil.getInstance("DB_A");
        const dbB = IDbUtil.getInstance("DB_B");

        await dbA.init(["employee", "department", "project"]);
        await dbB.init(["order", "product", "inventory"]);

        // Example A
        await dbA.createData("department", { name: "IT" }, res => console.log("DB_A Department:", res));
        await dbA.createData("employee", { name: "Alice", group: "IT", address: { city: "London" } }, res => console.log("DB_A Employee:", res));
        await dbA.createData("employee", { name: "Bob", group: "HR", address: { city: "Paris" } }, res => console.log("DB_A Employee:", res));

        dbA.getMany("employee", { "address.city": "London" }, res => console.log("DB_A Employees in London:", res));

        // Example B
        await dbB.createData("product", { name: "Laptop", stock: 10 }, res => console.log("DB_B Product:", res));
        await dbB.createData("order", { productId: 1, quantity: 2 }, res => console.log("DB_B Order:", res));

        // Transaction example on DB_A
        await dbA.transaction(["employee", "project"], stores => {
            stores.employee.add({ name: "Charlie", group: "IT", address: { city: "London" } });
            stores.project.add({ name: "Project X" });
        });

        // Dump & Import example
        const dump = await dbA.dumpBuckets(["employee", "department", "project"]);
        console.log("DB_A Dump JSON:", dump);
        await dbB.importBuckets(dump); // import into DB_B for testing
    }
}

// Run example
// IDbUtilExample.run();

