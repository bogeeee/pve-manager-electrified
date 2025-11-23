Ext.define('PVE.data.ResourceStore', {
    extend: 'Proxmox.data.UpdateStore',
    singleton: true,

    nodeCache: {},

    findVMID: function (vmid) {
        let me = this;
        return me.findExact('vmid', parseInt(vmid, 10)) >= 0;
    },

    // returns the cached data from all nodes
    getNodes: function () {
        let me = this;

        let nodes = [];
        me.each(function (record) {
            if (record.get('type') === 'node') {
                nodes.push(record.getData());
            }
        });

        return nodes;
    },

    getNodeById: function (id) {
        let me = this;

        if (!me.nodeCache[id]) {
            let idx = me.findExact('id', `node/${id}`);
            me.nodeCache[id] = me.getAt(idx);
        }

        return me.nodeCache[id];
    },

    clearCache: function () {
        let me = this;
        me.nodeCache = {};
    },

    storageIsShared: function (storage_path) {
        let me = this;

        let index = me.findExact('id', storage_path);
        if (index >= 0) {
            return me.getAt(index).data.shared;
        } else {
            return undefined;
        }
    },

    guestNode: function (vmid) {
        let me = this;

        let index = me.findExact('vmid', parseInt(vmid, 10));

        return me.getAt(index).data.node;
    },

    guestName: function (vmid) {
        let me = this;
        let index = me.findExact('vmid', parseInt(vmid, 10));
        if (index < 0) {
            return '-';
        }
        let rec = me.getAt(index).data;
        if ('name' in rec) {
            return rec.name;
        }
        return '';
    },

    refresh: function () {
        let me = this;
        // can only refresh if we're loaded at least once and are not currently loading
        if (!me.isLoading() && me.isLoaded()) {
            let records = (me.getData().getSource() || me.getData()).getRange();
            me.fireEvent('load', me, records);
        }
    },

    constructor: function (config) {
        let me = this;

        config = config || {};

        let field_defaults = {
            type: {
                header: gettext('Type'),
                type: 'string',
                renderer: PVE.Utils.render_resource_type,
                sortable: true,
                hideable: false,
                width: 100,
            },
            id: {
                header: 'ID',
                type: 'string',
                hidden: true,
                sortable: true,
                width: 80,
            },
            running: {
                header: gettext('Online'),
                type: 'boolean',
                renderer: Proxmox.Utils.format_boolean,
                hidden: true,
                convert: function (value, record) {
                    var info = record.data;
                    return Ext.isNumeric(info.uptime) && info.uptime > 0;
                },
            },
            text: {
                header: gettext('Description'),
                type: 'string',
                sortable: true,
                width: 200,
                convert: function (value, record) {
                    if (value) {
                        return value;
                    }

                    let info = record.data,
                        text;
                    if (Ext.isNumeric(info.vmid) && info.vmid > 0) {
                        text = String(info.vmid);
                        if (info.name) {
                            text += ' (' + info.name + ')';
                        }
                    } else {
                        // node, pool, storage
                        text = info[info.type] || info.id;
                        if (info.node && info.type !== 'node') {
                            text += ' (' + info.node + ')';
                        }
                    }

                    return text;
                },
            },
            vmid: {
                header: 'VMID',
                type: 'integer',
                hidden: true,
                sortable: true,
                width: 80,
            },
            name: {
                header: gettext('Name'),
                hidden: true,
                sortable: true,
                type: 'string',
            },
            disk: {
                header: gettext('Disk usage'),
                type: 'integer',
                renderer: PVE.Utils.render_disk_usage,
                sortable: true,
                width: 100,
                hidden: true,
            },
            diskuse: {
                header: gettext('Disk usage') + ' %',
                type: 'number',
                sortable: true,
                renderer: PVE.Utils.render_disk_usage_percent,
                width: 100,
                calculate: PVE.Utils.calculate_disk_usage,
                sortType: 'asFloat',
            },
            maxdisk: {
                header: gettext('Disk size'),
                type: 'integer',
                renderer: Proxmox.Utils.render_size,
                sortable: true,
                hidden: true,
                width: 100,
            },
            mem: {
                header: gettext('Memory usage'),
                type: 'integer',
                renderer: PVE.Utils.render_mem_usage,
                sortable: true,
                hidden: true,
                width: 100,
            },
            memhost: {
                header: gettext('Host Memory usage'),
                type: 'integer',
                renderer: PVE.Utils.render_mem_usage,
                sortable: true,
                hidden: true,
                width: 100,
            },
            memuse: {
                header: gettext('Memory usage') + ' %',
                type: 'number',
                renderer: PVE.Utils.render_mem_usage_percent,
                calculate: PVE.Utils.calculate_mem_usage,
                sortType: 'asFloat',
                sortable: true,
                width: 100,
            },
            maxmem: {
                header: gettext('Memory size'),
                type: 'integer',
                renderer: Proxmox.Utils.render_size,
                hidden: true,
                sortable: true,
                width: 100,
            },
            cpu: {
                header: gettext('CPU usage'),
                type: 'float',
                renderer: Proxmox.Utils.render_cpu,
                sortable: true,
                width: 100,
            },
            maxcpu: {
                header: gettext('maxcpu'),
                type: 'integer',
                hidden: true,
                sortable: true,
                width: 60,
            },
            diskread: {
                header: gettext('Total Disk Read'),
                type: 'integer',
                hidden: true,
                sortable: true,
                renderer: Proxmox.Utils.format_size,
                width: 100,
            },
            diskwrite: {
                header: gettext('Total Disk Write'),
                type: 'integer',
                hidden: true,
                sortable: true,
                renderer: Proxmox.Utils.format_size,
                width: 100,
            },
            netin: {
                header: gettext('Total NetIn'),
                type: 'integer',
                hidden: true,
                sortable: true,
                renderer: Proxmox.Utils.format_size,
                width: 100,
            },
            netout: {
                header: gettext('Total NetOut'),
                type: 'integer',
                hidden: true,
                sortable: true,
                renderer: Proxmox.Utils.format_size,
                width: 100,
            },
            template: {
                header: gettext('Template'),
                type: 'integer',
                hidden: true,
                sortable: true,
                width: 60,
            },
            uptime: {
                header: gettext('Uptime'),
                type: 'integer',
                renderer: Proxmox.Utils.render_uptime,
                sortable: true,
                width: 110,
            },
            node: {
                header: gettext('Node'),
                type: 'string',
                hidden: true,
                sortable: true,
                width: 110,
            },
            storage: {
                header: gettext('Storage'),
                type: 'string',
                hidden: true,
                sortable: true,
                width: 110,
            },
            pool: {
                header: gettext('Pool'),
                type: 'string',
                hidden: true,
                sortable: true,
                width: 110,
            },
            hastate: {
                header: gettext('HA State'),
                type: 'string',
                defaultValue: 'unmanaged',
                hidden: true,
                sortable: true,
            },
            status: {
                header: gettext('Status'),
                type: 'string',
                hidden: true,
                sortable: true,
                width: 110,
            },
            lock: {
                header: gettext('Lock'),
                type: 'string',
                hidden: true,
                sortable: true,
                width: 110,
            },
            hostcpu: {
                header: gettext('Host CPU usage'),
                type: 'float',
                renderer: PVE.Utils.render_hostcpu,
                calculate: PVE.Utils.calculate_hostcpu,
                sortType: 'asFloat',
                sortable: true,
                width: 100,
            },
            hostmemuse: {
                header: gettext('Host Memory usage') + ' %',
                type: 'number',
                renderer: PVE.Utils.render_hostmem_usage_percent,
                calculate: PVE.Utils.calculate_hostmem_usage,
                sortType: 'asFloat',
                sortable: true,
                width: 100,
            },
            tags: {
                header: gettext('Tags'),
                renderer: (value) => PVE.Utils.renderTags(value, PVE.UIOptions.tagOverrides),
                type: 'string',
                sortable: true,
                flex: 1,
            },
            // note: flex only last column to keep info closer together
        };

        let fields = [];
        let fieldNames = [];
        Ext.Object.each(field_defaults, function (key, value) {
            var field = { name: key, type: value.type };
            if (Ext.isDefined(value.convert)) {
                field.convert = value.convert;
            }

            if (Ext.isDefined(value.calculate)) {
                field.calculate = value.calculate;
            }

            if (Ext.isDefined(value.defaultValue)) {
                field.defaultValue = value.defaultValue;
            }

            fields.push(field);
            fieldNames.push(key);
        });

        Ext.define('PVEResources', {
            extend: 'Ext.data.Model',
            fields: fields,
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/resources',
            },
        });

        Ext.define('PVETree', {
            extend: 'Ext.data.Model',
            fields: fields,
            proxy: { type: 'memory' },
        });

        Ext.apply(config, {
            storeid: 'PVEResources',
            model: 'PVEResources',
            defaultColumns: function () {
                let res = [];
                Ext.Object.each(field_defaults, function (field, info) {
                    let fieldInfo = Ext.apply({ dataIndex: field }, info);
                    res.push(fieldInfo);
                });
                return res;
            },
            fieldNames: fieldNames,
        });

        me.callParent([config]);

        me.on('beforeload', me.clearCache, me);
    },
});
