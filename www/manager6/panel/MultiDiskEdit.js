Ext.define('PVE.panel.MultiDiskPanel', {
    extend: 'Ext.panel.Panel',

    mixins: ['Proxmox.Mixin.CBind'],

    setNodename: function (nodename) {
        this.items.each((panel) => panel.setNodename(nodename));
    },

    border: false,
    bodyBorder: false,

    importDisk: false, // allow import panel

    layout: 'card',

    controller: {
        xclass: 'Ext.app.ViewController',

        vmconfig: {},

        onAdd: function () {
            this.addDiskChecked(false);
        },

        onImport: function () {
            this.addDiskChecked(true);
        },

        addDiskChecked: function (importDisk) {
            let me = this;
            me.lookup('addButton').setDisabled(true);
            me.lookup('addImportButton').setDisabled(true);
            me.addDisk(importDisk);
            let count = me.lookup('grid').getStore().getCount() + 1; // +1 is from ide2
            me.lookup('addButton').setDisabled(count >= me.maxCount);
            me.lookup('addImportButton').setDisabled(count >= me.maxCount);
        },

        getNextFreeDisk: function (vmconfig) {
            throw 'implement in subclass';
        },

        addPanel: function (itemId, vmconfig, nextFreeDisk, importDisk) {
            throw 'implement in subclass';
        },

        // define in subclass
        diskSorter: undefined,

        addDisk: function (importDisk) {
            let me = this;
            let grid = me.lookup('grid');
            let store = grid.getStore();

            // get free disk id
            let vmconfig = me.getVMConfig(true);
            let nextFreeDisk = me.getNextFreeDisk(vmconfig);
            if (!nextFreeDisk) {
                return;
            }

            // add store entry + panel
            let itemId = 'disk-card-' + ++Ext.idSeed;
            let rec = store.add({
                name: nextFreeDisk.confid,
                itemId,
            })[0];

            let panel = me.addPanel(itemId, vmconfig, nextFreeDisk, importDisk);
            panel.updateVMConfig(vmconfig);

            // we need to setup a validitychange handler, so that we can show
            // that a disk has invalid fields
            let fields = panel.query('field');
            fields.forEach((el) =>
                el.on('validitychange', () => {
                    let valid = fields.every((field) => field.isValid());
                    rec.set('valid', valid);
                    me.checkValidity();
                }),
            );

            store.sort(me.diskSorter);

            // select if the panel added is the only one
            if (store.getCount() === 1) {
                grid.getSelectionModel().select(0, false);
            }
        },

        getBaseVMConfig: function () {
            throw 'implement in subclass';
        },

        getVMConfig: function (all) {
            let me = this;

            let vmconfig = me.getBaseVMConfig();

            me.lookup('grid')
                .getStore()
                .each((rec) => {
                    if (all || rec.get('valid')) {
                        vmconfig[rec.get('name')] = rec.get('itemId');
                    }
                });

            return vmconfig;
        },

        checkValidity: function () {
            let me = this;
            let valid = me.lookup('grid').getStore().findExact('valid', false) === -1;
            me.lookup('validationfield').setValue(valid);
        },

        updateVMConfig: function () {
            let me = this;
            let view = me.getView();
            let grid = me.lookup('grid');
            let store = grid.getStore();

            let vmconfig = me.getVMConfig();

            let valid = true;

            store.each((rec) => {
                let itemId = rec.get('itemId');
                let name = rec.get('name');
                let panel = view.getComponent(itemId);
                if (!panel) {
                    throw 'unexpected missing panel';
                }

                // copy config for each panel and remote its own id
                let panel_vmconfig = Ext.apply({}, vmconfig);
                if (panel_vmconfig[name] === itemId) {
                    delete panel_vmconfig[name];
                }

                if (!rec.get('valid')) {
                    valid = false;
                }

                panel.updateVMConfig(panel_vmconfig);
            });

            me.lookup('validationfield').setValue(valid);

            return vmconfig;
        },

        onChange: function (panel, newVal) {
            let me = this;
            let store = me.lookup('grid').getStore();

            let el = store.findRecord('itemId', panel.itemId, 0, false, true, true);
            if (el.get('name') === newVal) {
                // do not update if there was no change
                return;
            }

            el.set('name', newVal);
            el.commit();

            store.sort(me.diskSorter);

            // so that it happens after the layouting
            setTimeout(function () {
                me.updateVMConfig();
            }, 10);
        },

        onRemove: function (tableview, rowIndex, colIndex, item, event, record) {
            let me = this;
            let grid = me.lookup('grid');
            let store = grid.getStore();
            let removed_idx = store.indexOf(record);

            let selection = grid.getSelection()[0];
            let selected_idx = store.indexOf(selection);

            if (selected_idx === removed_idx) {
                let newidx = store.getCount() > removed_idx + 1 ? removed_idx + 1 : removed_idx - 1;
                grid.getSelectionModel().select(newidx, false);
            }

            store.remove(record);
            me.getView().remove(record.get('itemId'));
            me.lookup('addButton').setDisabled(false);
            me.lookup('addImportButton').setDisabled(false);
            me.updateVMConfig();
            me.checkValidity();
        },

        onSelectionChange: function (grid, selection) {
            let me = this;
            if (!selection || selection.length < 1) {
                return;
            }

            me.getView().setActiveItem(selection[0].data.itemId);
        },

        control: {
            inputpanel: {
                diskidchange: 'onChange',
            },
            'grid[reference=grid]': {
                selectionchange: 'onSelectionChange',
            },
        },

        init: function (view) {
            let me = this;
            me.onAdd();
            me.lookup('grid').getSelectionModel().select(0, false);
        },
    },

    dockedItems: [
        {
            xtype: 'container',
            layout: {
                type: 'vbox',
                align: 'stretch',
            },
            dock: 'left',
            border: false,
            width: 130,
            cbind: {}, // for nested cbinds
            items: [
                {
                    xtype: 'grid',
                    hideHeaders: true,
                    reference: 'grid',
                    flex: 1,
                    emptyText: gettext('No Disks'),
                    margin: '0 0 5 0',
                    store: {
                        fields: ['name', 'itemId', 'valid'],
                        data: [],
                    },
                    columns: [
                        {
                            dataIndex: 'name',
                            renderer: function (val, md, rec) {
                                let warn = '';
                                if (!rec.get('valid')) {
                                    warn = ' <i class="fa warning fa-warning"></i>';
                                }
                                return val + warn;
                            },
                            flex: 1,
                        },
                        {
                            xtype: 'actioncolumn',
                            width: 30,
                            align: 'center',
                            menuDisabled: true,
                            items: [
                                {
                                    iconCls: 'x-fa fa-trash critical',
                                    tooltip: 'Delete',
                                    handler: 'onRemove',
                                    isActionDisabled: 'deleteDisabled',
                                },
                            ],
                        },
                    ],
                },
                {
                    xtype: 'button',
                    reference: 'addButton',
                    text: gettext('Add'),
                    iconCls: 'fa fa-plus-circle',
                    handler: 'onAdd',
                },
                {
                    xtype: 'button',
                    reference: 'addImportButton',
                    text: gettext('Import'),
                    iconCls: 'fa fa-cloud-download',
                    handler: 'onImport',
                    margin: '5 0 0 0',
                    cbind: {
                        disabled: '{!importDisk}',
                        hidden: '{!importDisk}',
                    },
                },
                {
                    // dummy field to control wizard validation
                    xtype: 'textfield',
                    hidden: true,
                    reference: 'validationfield',
                    submitValue: false,
                    value: true,
                    validator: (val) => !!val,
                },
            ],
        },
    ],
});
