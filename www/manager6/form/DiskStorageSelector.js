Ext.define('PVE.form.DiskStorageSelector', {
    extend: 'Ext.container.Container',
    alias: 'widget.pveDiskStorageSelector',

    layout: 'fit',
    defaults: {
        margin: '0 0 5 0',
    },

    // the fieldLabel for the storageselector
    storageLabel: gettext('Storage'),

    // the content to show (e.g., images or rootdir)
    storageContent: undefined,

    // if true, selects the first available storage
    autoSelect: false,

    allowBlank: false,
    emptyText: '',

    // hides the selection field
    // this is always hidden on creation,
    // and only shown when the storage needs a selection and
    // hideSelection is not true
    hideSelection: undefined,

    // hides the size field (e.g, for the efi disk dialog)
    hideSize: false,

    // hides the format field
    hideFormat: false,

    // sets the initial size value
    // string because else we get a type confusion
    defaultSize: '32',

    changeStorage: function (f, value) {
        var me = this;
        var formatsel = me.getComponent('diskformat');
        var hdfilesel = me.getComponent('hdimage');
        var hdsizesel = me.getComponent('disksize');

        // initial store load, and reset/deletion of the storage
        if (!value) {
            hdfilesel.setDisabled(true);
            hdfilesel.setVisible(false);

            formatsel.setDisabled(true);
            return;
        }

        var rec = f.store.getById(value);
        // if the storage is not defined, or valid,
        // we cannot know what to enable/disable
        if (!rec) {
            return;
        }

        let validFormats = {};
        let defaultFormat = 'raw';
        let selectFormat = defaultFormat;
        if (rec.data.formats) {
            for (const format of rec.data.formats.supported) {
                validFormats[format] = true;
            }
            defaultFormat = rec.data.formats.default;
        } else if (rec.data.format) {
            // legacy api, just for compatibility
            // 0 is the formats, 1 the default in the backend
            validFormats = rec.data.format[0];
            defaultFormat = rec.data.format[1];
        }

        if (Object.keys(validFormats).length > 0) {
            delete validFormats.subvol; // we never need subvol in the gui
            if (validFormats.qcow2) {
                selectFormat = 'qcow2';
            } else if (validFormats.raw) {
                selectFormat = 'raw';
            } else {
                selectFormat = defaultFormat;
            }
        }

        var select = !!rec.data.select_existing && !me.hideSelection;

        let numberOfValidFormats = Ext.Object.getValues(validFormats).filter(
            (valid) => !!valid,
        ).length;
        formatsel.setDisabled(me.hideFormat || numberOfValidFormats <= 1);
        formatsel.setValue(selectFormat);

        hdfilesel.setDisabled(!select);
        hdfilesel.setVisible(select);
        if (select) {
            hdfilesel.setStorage(value);
        }

        hdsizesel.setDisabled(select || me.hideSize);
        hdsizesel.setVisible(!select && !me.hideSize);
    },

    setNodename: function (nodename) {
        var me = this;
        var hdstorage = me.getComponent('hdstorage');
        var hdfilesel = me.getComponent('hdimage');

        hdstorage.setNodename(nodename);
        hdfilesel.setNodename(nodename);
    },

    setDisabled: function (value) {
        var me = this;
        var hdstorage = me.getComponent('hdstorage');

        // reset on disable
        if (value) {
            hdstorage.setValue();
        }
        hdstorage.setDisabled(value);

        // disabling does not always fire this event and we do not need
        // the value of the validity
        hdstorage.fireEvent('validitychange');
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'pveStorageSelector',
                itemId: 'hdstorage',
                name: 'hdstorage',
                fieldLabel: me.storageLabel,
                nodename: me.nodename,
                storageContent: me.storageContent,
                disabled: me.disabled,
                autoSelect: me.autoSelect,
                allowBlank: me.allowBlank,
                emptyText: me.emptyText,
                listeners: {
                    change: {
                        fn: me.changeStorage,
                        scope: me,
                    },
                },
            },
            {
                xtype: 'pveFileSelector',
                name: 'hdimage',
                itemId: 'hdimage',
                fieldLabel: gettext('Disk image'),
                nodename: me.nodename,
                disabled: true,
                hidden: true,
            },
            {
                xtype: 'numberfield',
                itemId: 'disksize',
                name: 'disksize',
                fieldLabel: `${gettext('Disk size')} (${gettext('GiB')})`,
                hidden: me.hideSize,
                disabled: me.hideSize,
                minValue: 0.001,
                maxValue: 128 * 1024,
                decimalPrecision: 3,
                value: me.defaultSize,
                allowBlank: false,
            },
            {
                xtype: 'pveDiskFormatSelector',
                itemId: 'diskformat',
                name: 'diskformat',
                fieldLabel: gettext('Format'),
                nodename: me.nodename,
                disabled: true,
                hidden: me.hideFormat || me.storageContent === 'rootdir',
                value: 'qcow2',
                allowBlank: false,
            },
        ];

        // use it to disable the children but not ourself
        me.disabled = false;

        me.callParent();
    },
});
