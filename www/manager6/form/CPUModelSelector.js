Ext.define('PVE.data.CPUModel', {
    extend: 'Ext.data.Model',
    fields: [{ name: 'name' }, { name: 'vendor' }, { name: 'custom' }, { name: 'displayname' }],
});

Ext.define('PVE.form.CPUModelSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.CPUModelSelector'],

    valueField: 'name',
    displayField: 'displayname',

    emptyText: Proxmox.Utils.defaultText + ' (kvm64)',
    allowBlank: true,

    editable: true,
    anyMatch: true,
    forceSelection: true,
    autoSelect: false,

    deleteEmpty: true,

    listConfig: {
        columns: [
            {
                header: gettext('Model'),
                dataIndex: 'displayname',
                hideable: false,
                sortable: true,
                flex: 3,
            },
            {
                header: gettext('Vendor'),
                dataIndex: 'vendor',
                hideable: false,
                sortable: true,
                flex: 2,
            },
        ],
        width: 360,
    },

    store: {
        autoLoad: true,
        model: 'PVE.data.CPUModel',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes/localhost/capabilities/qemu/cpu',
        },
        sorters: [
            {
                sorterFn: function (recordA, recordB) {
                    let a = recordA.data;
                    let b = recordB.data;

                    let vendorOrder = PVE.Utils.cpu_vendor_order;
                    let orderA = vendorOrder[a.vendor] || vendorOrder._default_;
                    let orderB = vendorOrder[b.vendor] || vendorOrder._default_;

                    if (orderA > orderB) {
                        return 1;
                    } else if (orderA < orderB) {
                        return -1;
                    }

                    // Within same vendor, sort alphabetically
                    return a.name.localeCompare(b.name);
                },
                direction: 'ASC',
            },
        ],
        listeners: {
            load: function (store, records, success) {
                if (success) {
                    records.forEach((rec) => {
                        rec.data.displayname = rec.data.name.replace(/^custom-/, '');

                        let vendor = rec.data.vendor;

                        if (rec.data.name === 'host') {
                            vendor = 'Host';
                        }

                        // We receive vendor names as given to QEMU as CPUID
                        vendor = PVE.Utils.cpu_vendor_map[vendor] || vendor;

                        if (rec.data.custom) {
                            vendor = gettext('Custom') + ` (${vendor})`;
                        }

                        rec.data.vendor = vendor;
                    });

                    store.sort();
                }
            },
        },
    },
});
