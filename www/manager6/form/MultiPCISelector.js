Ext.define('PVE.form.MultiPCISelector', {
    extend: 'Ext.grid.Panel',
    alias: 'widget.pveMultiPCISelector',

    emptyText: gettext('No Devices found'),

    mixins: {
        field: 'Ext.form.field.Field',
    },

    // will be called after loading finished
    onLoadCallBack: Ext.emptyFn,

    getValue: function () {
        let me = this;
        return me.value ?? [];
    },

    getSubmitData: function () {
        let me = this;
        let res = {};
        res[me.name] = me.getValue();
        return res;
    },

    setValue: function (value) {
        let me = this;

        value ??= [];

        me.updateSelectedDevices(value);

        return me.mixins.field.setValue.call(me, value);
    },

    getErrors: function () {
        let me = this;

        let errorCls = ['x-form-trigger-wrap-default', 'x-form-trigger-wrap-invalid'];

        if (me.getValue().length < 1) {
            let error = gettext('Must choose at least one device');
            me.addCls(errorCls);
            me.getActionEl()?.dom.setAttribute('data-errorqtip', error);

            return [error];
        }

        me.removeCls(errorCls);
        me.getActionEl()?.dom.setAttribute('data-errorqtip', '');

        return [];
    },

    viewConfig: {
        getRowClass: function (record) {
            if (record.data.disabled === true) {
                return 'x-item-disabled';
            }
            return '';
        },
    },

    updateSelectedDevices: function (value = []) {
        let me = this;

        let recs = [];
        let store = me.getStore();

        for (const map of value) {
            let parsed = PVE.Parser.parsePropertyString(map);
            if (parsed.node !== me.nodename) {
                continue;
            }

            let rec = store.getById(parsed.path);
            if (rec) {
                recs.push(rec);
            }
        }

        me.suspendEvent('change');
        me.setSelection();
        me.setSelection(recs);
        me.resumeEvent('change');
    },

    setNodename: function (nodename) {
        let me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }

        me.nodename = nodename;

        me.getStore().setProxy({
            type: 'proxmox',
            url: '/api2/json/nodes/' + me.nodename + '/hardware/pci?pci-class-blacklist=',
        });

        me.setSelection();

        me.getStore().load({
            callback: (recs, op, success) => me.addSlotRecords(recs, op, success),
        });
    },

    setMdev: function (mdev) {
        let me = this;
        if (mdev) {
            me.getStore().addFilter({
                id: 'mdev-filter',
                property: 'mdev',
                value: '1',
                operator: '=',
            });
        } else {
            me.getStore().removeFilter('mdev-filter');
        }
        me.setSelection();
    },

    // adds the virtual 'slot' records (e.g. '0000:01:00') to the store
    addSlotRecords: function (records, _op, success) {
        let me = this;
        if (!success) {
            return;
        }

        let slots = {};
        records.forEach((rec) => {
            let slotname = rec.data.id.slice(0, -2); // remove function
            if (slots[slotname] !== undefined) {
                slots[slotname].count++;
                rec.set('slot', slots[slotname]);
                return;
            }
            slots[slotname] = {
                count: 1,
            };

            rec.set('slot', slots[slotname]);

            if (rec.data.id.endsWith('.0')) {
                slots[slotname].device = rec.data;
            }
        });

        let store = me.getStore();

        for (const [slot, { count, device }] of Object.entries(slots)) {
            if (count === 1) {
                continue;
            }
            store.add(
                Ext.apply(
                    {},
                    {
                        id: slot,
                        mdev: undefined,
                        device_name: gettext('Pass through all functions as one device'),
                    },
                    device,
                ),
            );
        }

        me.updateSelectedDevices(me.value);
    },

    selectionChange: function (_grid, selection) {
        let me = this;

        let ids = {};
        selection
            .filter((rec) => rec.data.id.indexOf('.') === -1)
            .forEach((rec) => {
                ids[rec.data.id] = true;
            });

        let to_disable = [];

        me.getStore().each((rec) => {
            let id = rec.data.id;
            rec.set('disabled', false);
            if (id.indexOf('.') === -1) {
                return;
            }
            let slot = id.slice(0, -2); // remove function

            if (ids[slot]) {
                to_disable.push(rec);
                rec.set('disabled', true);
            }
        });

        me.suspendEvent('selectionchange');
        me.getSelectionModel().deselect(to_disable);
        me.resumeEvent('selectionchange');

        me.value = me.getSelection().map((rec) => {
            let res = {
                path: rec.data.id,
                node: me.nodename,
                id: `${rec.data.vendor}:${rec.data.device}`.replace(/0x/g, ''),
                'subsystem-id': `${rec.data.subsystem_vendor}:${rec.data.subsystem_device}`.replace(
                    /0x/g,
                    '',
                ),
            };

            if (rec.data.iommugroup !== -1) {
                res.iommugroup = rec.data.iommugroup;
            }

            return PVE.Parser.printPropertyString(res);
        });
        me.checkChange();
    },

    selModel: {
        type: 'checkboxmodel',
        mode: 'SIMPLE',
    },

    columns: [
        {
            header: 'ID',
            dataIndex: 'id',
            renderer: function (value, _md, rec) {
                if (value.match(/\.[0-9a-f]/i) && rec.data.slot?.count > 1) {
                    return `&emsp;${value}`;
                }
                return value;
            },
            width: 150,
        },
        {
            header: gettext('IOMMU Group'),
            dataIndex: 'iommugroup',
            renderer: (v, _md, rec) => (rec.data.slot === rec.data.id ? '' : v === -1 ? '-' : v),
            width: 50,
        },
        {
            header: gettext('Vendor'),
            dataIndex: 'vendor_name',
            flex: 3,
        },
        {
            header: gettext('Device'),
            dataIndex: 'device_name',
            flex: 6,
        },
        {
            header: gettext('Mediated Devices'),
            dataIndex: 'mdev',
            flex: 1,
            renderer: function (val) {
                return Proxmox.Utils.format_boolean(!!val);
            },
        },
    ],

    listeners: {
        selectionchange: function () {
            this.selectionChange(...arguments);
        },
    },

    store: {
        fields: [
            'id',
            'vendor_name',
            'device_name',
            'vendor',
            'device',
            'iommugroup',
            'mdev',
            'subsystem_vendor',
            'subsystem_device',
            'disabled',
            {
                name: 'subsystem-vendor',
                calculate: function (data) {
                    return data.subsystem_vendor;
                },
            },
            {
                name: 'subsystem-device',
                calculate: function (data) {
                    return data.subsystem_device;
                },
            },
        ],
        sorters: [
            {
                property: 'id',
                direction: 'ASC',
            },
        ],
    },

    initComponent: function () {
        let me = this;

        let nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        me.mon(me.getStore(), 'load', me.onLoadCallBack);

        Proxmox.Utils.monStoreErrors(me, me.getStore(), true);

        me.setNodename(nodename);

        me.initField();
    },
});
