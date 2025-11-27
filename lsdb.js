/**
 * =============================================================================
 * LSDB.js – LocalStorage-based Lightweight Database Utility
 * =============================================================================
 *
 * Overview:
 * ---------
 * LSDB.js provides a simple, in-browser database abstraction on top of
 * localStorage. It allows developers to create named buckets (tables),
 * perform CRUD operations, and query nested objects using LINQ-style methods
 * via LSQuery. LSDBUtil wraps LSDB with API-like asynchronous functions to
 * mimic server calls.
 *
 * Features:
 * ---------
 * 1. Namespaced storage:
 *      - Supports multiple buckets within a given prefix namespace.
 *
 * 2. Bucket operations:
 *      - listBuckets(), createBucket(name), deleteBucket(name)
 *      - Buckets are created idempotently; calling createBucket multiple times
 *        will not overwrite existing data unless explicitly removed.
 *
 * 3. CRUD operations per bucket:
 *      - insert(item), all(), filterBy({ prop: value }), update(id, newData),
 *        delete(id)
 *
 * 4. LINQ-style querying with LSQuery:
 *      - where(predicate), orderBy(selector), orderByDescending(selector),
 *        select(selector), firstOrDefault(predicate), toList()
 *
 * 5. Nested object querying and flexible filters:
 *      - Supports dot-notation for nested fields: "address.city"
 *      - AND, OR, and grouped conditions via LSDBQuery
 *
 * 6. API-like async wrapper (LSDBUtil):
 *      - getData(url, callback), filterData(url, callback)
 *      - createData(url, payload, callback), updateData(url, payload, callback)
 *      - deleteData(url, callback), dump(bucketName), import(jsonData)
 *      - Automatically extracts bucket from URL query string (?bucket=...)
 *      - Mimics network latency for testing frontend behaviors
 *
 * 7. Data import/export:
 *      - dump() → JSON string of all bucket contents
 *      - import(jsonData, overwrite) → populate or merge buckets
 *
 * 8. Example usage:
 * -----------------
 * // Create bucket and insert
 * LSDBUtil.createData("/?bucket=employee", { name: "Alice", group: "IT", address: { city: "London" } }, res => console.log(res));
 *
 * // Query nested fields
 * let results = new LSDBQuery("employee")
 *      .where("address.city", "eq", "London")
 *      .where("group", "eq", "IT")
 *      .execute();
 *
 * console.log("Employees in London IT group:", results);
 *
 * // Dump & import
 * const dump = LSDBUtil.dump();
 * LSDBUtil.import(dump);
 *
 * Notes:
 * ------
 * - All operations are synchronous on top of localStorage but LSDBUtil
 *   mimics async network calls using setTimeout.
 * - Nested fields are queried using dot notation: "address.city"
 * - Supports AND, OR, and grouped OR conditions via LSDBQuery.
 * - Multiple developers can use different prefixes to sandbox data in
 *   localStorage.
 *
 * Author: Your Name
 * License: MIT
 * =============================================================================
 */


class LSQuery {
    constructor(data) {
        this.data = data;
    }

    where(predicate) {
        return new LSQuery(this.data.filter(predicate));
    }

    orderBy(selector) {
        return new LSQuery([...this.data].sort((a, b) => {
            const x = selector(a);
            const y = selector(b);
            return x > y ? 1 : x < y ? -1 : 0;
        }));
    }

    orderByDescending(selector) {
        return new LSQuery([...this.data].sort((a, b) => {
            const x = selector(a);
            const y = selector(b);
            return x < y ? 1 : x > y ? -1 : 0;
        }));
    }

    select(selector) {
        return new LSQuery(this.data.map(selector));
    }

    firstOrDefault(predicate = null) {
        if (!predicate) return this.data[0] || null;
        return this.data.find(predicate) || null;
    }

    toList() {
        return [...this.data];
    }
}


class LSDB {

    constructor(prefix = "LSDB_") {
        this.prefix = prefix;
    }

    // Build fully-qualified key
    _key(bucket) {
        return this.prefix + bucket;
    }

    _load(bucket) {
        const key = this._key(bucket);
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    }

    _save(bucket, data) {
        const key = this._key(bucket);
        localStorage.setItem(key, JSON.stringify(data));
    }

    _ensure(bucket) {
        const key = this._key(bucket);
        if (!localStorage.getItem(key)) {
            localStorage.setItem(key, JSON.stringify([]));
        }
    }

    // -------------------------------------------------------------
    // Bucket Operations ONLY within namespace
    // -------------------------------------------------------------

    listBuckets() {
        const buckets = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);

            if (key.startsWith(this.prefix)) {
                buckets.push(key.replace(this.prefix, ""));
            }
        }

        return buckets;
    }

    createBucket(bucket) {
        this._ensure(bucket);
        return this;
    }

    deleteBucket(bucket) {
        localStorage.removeItem(this._key(bucket));
        return this;
    }

    // -------------------------------------------------------------
    // Bucket Accessor
    // -------------------------------------------------------------
    bucket(bucketName) {
        this._ensure(bucketName);
        const db = this;

        return {
            insert(item) {
                const list = db._load(bucketName);
                const newItem = { id: crypto.randomUUID(), ...item };
                list.push(newItem);
                db._save(bucketName, list);
                return newItem;
            },

            all() {
                return new LSQuery(db._load(bucketName));
            },

            filterBy(props) {
                const list = db._load(bucketName);
                const filtered = list.filter(item =>
                    Object.entries(props).every(([k, v]) => item[k] === v)
                );
                return new LSQuery(filtered);
            },

            update(id, newData) {
                const list = db._load(bucketName);
                const i = list.findIndex(x => x.id === id);
                if (i === -1) return false;

                list[i] = { ...list[i], ...newData };
                db._save(bucketName, list);

                return list[i];
            },

            delete(id) {
                const list = db._load(bucketName);
                const newList = list.filter(x => x.id !== id);
                db._save(bucketName, newList);
                return true;
            }
        };
    }
}

class LSDBExamples {

    static run() {

        // Create DB instance (sandboxed)
        const db = new LSDB("APP_");

        // -------------------------------------------------------
        // 1. CREATE BUCKETS (TABLES)
        // -------------------------------------------------------
        db.createBucket("users")
            .createBucket("products")
            .createBucket("orders");

        console.log("Buckets:", db.listBuckets());


        // -------------------------------------------------------
        // 2. INSERT SAMPLE DATA
        // -------------------------------------------------------

        // USERS
        const u1 = db.bucket("users").insert({ name: "Mir", age: 40, role: "admin" });
        const u2 = db.bucket("users").insert({ name: "John", age: 22, role: "user" });
        const u3 = db.bucket("users").insert({ name: "Sara", age: 31, role: "user" });

        // PRODUCTS
        const p1 = db.bucket("products").insert({ name: "Laptop", price: 800 });
        const p2 = db.bucket("products").insert({ name: "Phone", price: 500 });
        const p3 = db.bucket("products").insert({ name: "Keyboard", price: 49 });

        // ORDERS
        db.bucket("orders").insert({ userId: u1.id, productId: p1.id, quantity: 1 });
        db.bucket("orders").insert({ userId: u1.id, productId: p3.id, quantity: 2 });
        db.bucket("orders").insert({ userId: u2.id, productId: p2.id, quantity: 1 });


        // -------------------------------------------------------
        // 3. BASIC QUERIES
        // -------------------------------------------------------

        console.log("All users:", db.bucket("users").all().toList());
        console.log("All products:", db.bucket("products").all().toList());
        console.log("All orders:", db.bucket("orders").all().toList());


        // -------------------------------------------------------
        // 4. LINQ-STYLE QUERYING
        // -------------------------------------------------------

        // Get users older than 25
        const adults = db.bucket("users")
            .all()
            .where(u => u.age > 25)
            .orderBy(u => u.name)
            .toList();

        console.log("Adults:", adults);


        // Get products cheaper than 600 and transform result
        const cheapProducts = db.bucket("products")
            .all()
            .where(p => p.price < 600)
            .select(p => `${p.name} - £${p.price}`)
            .toList();

        console.log("Cheap Products:", cheapProducts);


        // Get first admin
        const admin = db.bucket("users")
            .all()
            .firstOrDefault(u => u.role === "admin");

        console.log("First admin:", admin);


        // -------------------------------------------------------
        // 5. CRUD OPERATIONS
        // -------------------------------------------------------

        // UPDATE
        db.bucket("users").update(u2.id, { role: "editor" });

        console.log("Updated User John:", db.bucket("users").all().firstOrDefault(u => u.id === u2.id));

        // DELETE product
        db.bucket("products").delete(p3.id);
        console.log("Products after delete:", db.bucket("products").all().toList());


        // -------------------------------------------------------
        // 6. FILTER USING OBJECT
        // -------------------------------------------------------

        // All editors
        const editors = db.bucket("users").filterBy({ role: "editor" }).toList();
        console.log("Editors:", editors);


        // -------------------------------------------------------
        // 7. Example: JOIN-like behaviour (manual cross-bucket query)
        // -------------------------------------------------------

        // List orders with actual user + product names
        const orders = db.bucket("orders").all().toList();

        const orderDetails = orders.map(o => {
            const user = db.bucket("users").all().firstOrDefault(u => u.id === o.userId);
            const product = db.bucket("products").all().firstOrDefault(p => p.id === o.productId);
            return {
                orderId: o.id,
                customer: user?.name,
                product: product?.name,
                quantity: o.quantity
            };
        });

        console.log("Order Details (with user + product names):", orderDetails);



        // -------------------------------------------------------
        // Example DONE
        // -------------------------------------------------------
        return {
            buckets: db.listBuckets(),
            adults,
            cheapProducts,
            admin,
            orderDetails
        };
    }
}



var LSDBUtil = (function () {
    const lsdb = new LSDB("APP_");

    // Ensure some buckets exist for demo
    lsdb.createBucket("users").createBucket("products").createBucket("orders");

    // Helper to extract bucket from URL query string
    function getBucketFromUrl(url) {
        const params = new URLSearchParams(url.split("?")[1]);
        return params.get("bucket") || "default";
    }

    return {
        deepClone: Util.deepClone,
        project: Util.project,
        filter: Util.filter,
        filterAndGetProperty: Util.filterAndGetProperty,
        isEmpty: Util.isEmpty,
        setLocalData: Util.setLocalData,
        getLocalData: Util.getLocalData,
        removeLocalData: Util.removeLocalData,
        showSuccess: Util.showSuccess,
        showInfo: Util.showInfo,
        showError: Util.showError,

        getData: function (url, callback, errorCallback = Util.defaultErrCallback) {
            const bucket = getBucketFromUrl(url);
            setTimeout(() => {
                try {
                    const data = lsdb.bucket(bucket).all().toList();
                    if (callback) callback(LSDBUtil.deepClone(data));
                } catch (err) {
                    if (errorCallback) errorCallback(err);
                }
            }, 300 + Math.random() * 200);
        },

        filterData: function (url, callback, errorCallback = Util.defaultErrCallback) {
            setTimeout(() => {
                try {
                    // Parse query string
                    const query = new URLSearchParams(url.split("?")[1] || "");
                    const bucket = query.get("bucket") || "default";

                    // Remove bucket from query params to get filter conditions
                    query.delete("bucket");

                    // Start LSDB query
                    let q = LSDBUtil.lsdbInstance.bucket(bucket).all();

                    // Apply filters from query string
                    query.forEach((value, key) => {
                        q = q.where((x) => x[key] != undefined && x[key].toString() === value);
                    });

                    // Return filtered results
                    if (callback) callback(LSDBUtil.deepClone(q.toList()));
                } catch (err) {
                    if (errorCallback) errorCallback(err);
                }
            }, 300 + Math.random() * 200); // mimic network delay
        },

        createData: function (url, payload, callback, errorCallback = Util.defaultErrCallback) {
            setTimeout(() => {
                try {
                    const bucket = getBucketFromUrl(url);
                    const item = lsdb.bucket(bucket).insert(payload);
                    if (callback) callback(LSDBUtil.deepClone(item));
                } catch (err) {
                    if (errorCallback) errorCallback(err);
                }
            }, 300 + Math.random() * 200);
        },

        updateData: function (url, payload, callback, errorCallback = Util.defaultErrCallback) {
            setTimeout(() => {
                try {
                    const bucket = getBucketFromUrl(url);
                    const updated = lsdb.bucket(bucket).update(payload.id, payload);
                    if (callback) callback(LSDBUtil.deepClone(updated));
                } catch (err) {
                    if (errorCallback) errorCallback(err);
                }
            }, 300 + Math.random() * 200);
        },

        deleteData: function (url, callback, errorCallback = Util.defaultErrCallback) {
            setTimeout(() => {
                try {
                    const bucket = getBucketFromUrl(url);
                    const id = url.split("/").pop(); // assume last segment is id
                    lsdb.bucket(bucket).delete(id);
                    if (callback) callback({ success: true });
                } catch (err) {
                    if (errorCallback) errorCallback(err);
                }
            }, 300 + Math.random() * 200);
        },

        dump: function (bucketName = null) {
            const dump = {};
            const buckets = bucketName ? [bucketName] : LSDBUtil.lsdbInstance.listBuckets();

            buckets.forEach(b => {
                dump[b] = LSDBUtil.lsdbInstance.bucket(b).all().toList();
            });

            return JSON.stringify(dump, null, 2);
        },
        import: function (jsonStr, overwrite = true) {
            let data;
            try {
                data = JSON.parse(jsonStr);
            } catch (err) {
                console.error("Invalid JSON for import", err);
                return;
            }

            Object.keys(data).forEach(bucketName => {
                if (overwrite) {
                    LSDBUtil.lsdbInstance.deleteBucket(bucketName);
                    LSDBUtil.lsdbInstance.createBucket(bucketName);
                } else if (!LSDBUtil.lsdbInstance.listBuckets().includes(bucketName)) {
                    LSDBUtil.lsdbInstance.createBucket(bucketName);
                }

                data[bucketName].forEach(item => {
                    LSDBUtil.lsdbInstance.bucket(bucketName).insert(item);
                });
            }); 
        },

        // Optional: expose LSDB instance for direct access
        lsdbInstance: lsdb,
    };
})();


//// example use of lsdb-util
//// List all users
//LSDBUtil.getData("/?bucket=users", (data) => {
//    console.log("All users:", data);
//});

//// Get all users with role=admin
//LSDBUtil.getMany("/?bucket=users&role=admin", (data) => {
//    console.log("Filtered admin users:", data);
//});

//// Get all products with price=75
//LSDBUtil.getMany("/?bucket=products&price=75", (data) => {
//    console.log("Products with price 75:", data);
//});

//// Create a new user
//LSDBUtil.createData("/?bucket=users", { name: "Alice", age: 28 }, (res) => {
//    console.log("Created user:", res);
//});

//// Update a user
//LSDBUtil.updateData("/?bucket=users", { id: "uuid-of-user", age: 29 }, (res) => {
//    console.log("Updated user:", res);
//});

//// Delete a user
//LSDBUtil.deleteData("/?bucket=users/uuid-of-user", (res) => {
//    console.log("Deleted user:", res);
//});


class LSDBQuery {
    constructor(bucket) {
        this.bucket = bucket;
        this.filters = [];   // array of {prop, op, value, logic} objects
        this.orGroups = [];  // optional OR groups
    }

    where(prop, op = "eq", value) {
        this.filters.push({ prop, op, value, logic: "AND" });
        return this;
    }

    orWhere(prop, op = "eq", value) {
        this.orGroups.push([{ prop, op, value }]);
        return this;
    }

    orGroup(groupFilters) {
        // groupFilters: array of {prop, op, value}
        this.orGroups.push(groupFilters);
        return this;
    }

    // evaluates a single item against AND filters
    _matchesAnd(item) {
        return this.filters.every(f => {
            const val = LSDBQuery._getNestedValue(item, f.prop);
            return LSDBQuery._compare(val, f.op, f.value);
        });
    }

    // evaluates a single item against OR groups
    _matchesOr(item) {
        if (!this.orGroups.length) return true; // no OR
        return this.orGroups.some(group => group.some(f => {
            const val = LSDBQuery._getNestedValue(item, f.prop);
            return LSDBQuery._compare(val, f.op, f.value);
        }));
    }

    execute() {
        return LSDBUtil.lsdbInstance
            .bucket(this.bucket)
            .all()
            .where(item => this._matchesAnd(item) && this._matchesOr(item))
            .toList();
    }

    static _getNestedValue(obj, prop) {
        return prop.split(".").reduce((o, k) => (o && k in o) ? o[k] : undefined, obj);
    }

    static _compare(val, op, expected) {
        switch (op) {
            case "eq": return val == expected;
            case "neq": return val != expected;
            case "lt": return val < expected;
            case "lte": return val <= expected;
            case "gt": return val > expected;
            case "gte": return val >= expected;
            default: return val == expected;
        }
    }
}

////Examples
//// Sample employee bucket
//LSDBUtil.createData("/?bucket=employee", { name: "Alice", address: { city: "London" }, group: "IT", age: 28 });
//LSDBUtil.createData("/?bucket=employee", { name: "Bob", address: { city: "Paris" }, group: "HR", age: 35 });
//LSDBUtil.createData("/?bucket=employee", { name: "Charlie", address: { city: "London" }, group: "HR", age: 40 });
//LSDBUtil.createData("/?bucket=employee", { name: "David", address: { city: "London" }, group: "IT", age: 22 });

//// --- AND example ---
//let results1 = new LSDBQuery("employee")
//    .where("address.city", "eq", "London")
//    .where("group", "eq", "IT")
//    .execute();
//console.log("London AND IT:", results1);

//// --- OR example ---
//let results2 = new LSDBQuery("employee")
//    .where("age", "gte", 35)
//    .orWhere("group", "eq", "IT")
//    .execute();
//console.log("Age>=35 OR Group=IT:", results2);

//// --- Nested AND+OR example ---
//let results3 = new LSDBQuery("employee")
//    .where("address.city", "eq", "London")
//    .orGroup([
//        { prop: "group", op: "eq", value: "HR" },
//        { prop: "age", op: "gte", value: 35 }
//    ])
//    .execute();
//console.log("City=London AND (group=HR OR age>=35):", results3);
