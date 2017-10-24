const ArgumentType = require('../extension-support/argument-type');
const BlockType = require('../extension-support/block-type');
const Cast = require('../util/cast');
const Clone = require('../util/clone');
const Color = require('../util/color');
const MathUtil = require('../util/math-util');
const RenderedTarget = require('../sprites/rendered-target');

/**
 * @typedef {object} PenState - the pen state associated with a particular target.
 * @property {Boolean} penDown - tracks whether the pen should draw for this target.
 * @property {number} hue - the current hue of the pen.
 * @property {number} shade - the current shade of the pen.
 * @property {PenAttributes} penAttributes - cached pen attributes for the renderer. This is the authoritative value for
 *   diameter but not for pen color.
 */

/**
 * Host for the Pen-related blocks in Scratch 3.0
 * @param {Runtime} runtime - the runtime instantiating this block package.
 * @constructor
 */
class Scratch3DroneBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * The ID of the renderer Drawable corresponding to the pen layer.
         * @type {int}
         * @private
         */
        this._penDrawableId = -1;

        /**
         * The ID of the renderer Skin corresponding to the pen layer.
         * @type {int}
         * @private
         */
        this._penSkinId = -1;

        this._onTargetCreated = this._onTargetCreated.bind(this);
        this._onTargetMoved = this._onTargetMoved.bind(this);

        runtime.on('targetWasCreated', this._onTargetCreated);
    }

    /**
     * The default pen state, to be used when a target has no existing pen state.
     * @type {PenState}
     */
    static get DEFAULT_PEN_STATE () {
        return {
            penDown: false,
            hue: 120,
            shade: 50,
            transparency: 0,
            penAttributes: {
                color4f: [0, 0, 1, 1],
                diameter: 1
            }
        };
    }

    /**
     * Place the pen layer in front of the backdrop but behind everything else.
     * We should probably handle this somewhere else... somewhere central that knows about pen, backdrop, video, etc.
     * Maybe it should be in the GUI?
     * @type {int}
     */
    static get PEN_ORDER () {
        return 1;
    }

    /**
     * The minimum and maximum allowed pen size.
     * @type {{min: number, max: number}}
     */
    static get PEN_SIZE_RANGE () {
        return {min: 1, max: 255};
    }

    /**
     * The key to load & store a target's pen-related state.
     * @type {string}
     */
    static get STATE_KEY () {
        return 'Scratch.pen';
    }

    /**
     * Clamp a pen size value to the range allowed by the pen.
     * @param {number} requestedSize - the requested pen size.
     * @returns {number} the clamped size.
     * @private
     */
    _clampPenSize (requestedSize) {
        return MathUtil.clamp(
            requestedSize,
            Scratch3DroneBlocks.PEN_SIZE_RANGE.min,
            Scratch3DroneBlocks.PEN_SIZE_RANGE.max
        );
    }

    /**
     * Retrieve the ID of the renderer "Skin" corresponding to the pen layer. If
     * the pen Skin doesn't yet exist, create it.
     * @returns {int} the Skin ID of the pen layer, or -1 on failure.
     * @private
     */
    _getPenLayerID () {
        if (this._penSkinId < 0 && this.runtime.renderer) {
            this._penSkinId = this.runtime.renderer.createPenSkin();
            this._penDrawableId = this.runtime.renderer.createDrawable();
            this.runtime.renderer.setDrawableOrder(this._penDrawableId, Scratch3DroneBlocks.PEN_ORDER);
            this.runtime.renderer.updateDrawableProperties(this._penDrawableId, {skinId: this._penSkinId});
        }
        return this._penSkinId;
    }

    /**
     * @param {Target} target - collect pen state for this target. Probably, but not necessarily, a RenderedTarget.
     * @returns {PenState} the mutable pen state associated with that target. This will be created if necessary.
     * @private
     */
    _getPenState (target) {
        let penState = target.getCustomState(Scratch3DroneBlocks.STATE_KEY);
        if (!penState) {
            penState = Clone.simple(Scratch3DroneBlocks.DEFAULT_PEN_STATE);
            target.setCustomState(Scratch3DroneBlocks.STATE_KEY, penState);
        }
        return penState;
    }

    /**
     * When a pen-using Target is cloned, clone the pen state.
     * @param {Target} newTarget - the newly created target.
     * @param {Target} [sourceTarget] - the target used as a source for the new clone, if any.
     * @listens Runtime#event:targetWasCreated
     * @private
     */
    _onTargetCreated (newTarget, sourceTarget) {
        if (sourceTarget) {
            const penState = sourceTarget.getCustomState(Scratch3DroneBlocks.STATE_KEY);
            if (penState) {
                newTarget.setCustomState(Scratch3DroneBlocks.STATE_KEY, Clone.simple(penState));
                if (penState.penDown) {
                    newTarget.addListener(RenderedTarget.EVENT_TARGET_MOVED, this._onTargetMoved);
                }
            }
        }
    }

    /**
     * Handle a target which has moved. This only fires when the pen is down.
     * @param {RenderedTarget} target - the target which has moved.
     * @param {number} oldX - the previous X position.
     * @param {number} oldY - the previous Y position.
     * @private
     */
    _onTargetMoved (target, oldX, oldY) {
        const penSkinId = this._getPenLayerID();
        if (penSkinId >= 0) {
            const penState = this._getPenState(target);
            this.runtime.renderer.penLine(penSkinId, penState.penAttributes, oldX, oldY, target.x, target.y);
            this.runtime.requestRedraw();
        }
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        return {
            id: 'drone',
            name: 'Drone',
            blocks: [
                {
                    opcode: 'takeOff',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'land',
                    blockType: BlockType.COMMAND
                },
                {
                    opcode: 'forwardForSecond',
                    text: 'Forward for [SECOND] seconds',
                    blockType: BlockType.COMMAND,
                    arguments: {
                        SECOND: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 0
                        }
                    }
                },
            ]
        };
    }

    /**
     * The pen "clear" block clears the pen layer's contents.
     */
    takeOff (args, util) {
        util.target.setXY(util.target.x, util.target.y + 15);
    }

    land (args, util) {
        util.target.setXY(0, 0);
    }

    forwardForSecond (args, util){
        const dx = Cast.toNumber(args.SECOND);
        console.log(util.target);
        util.target.setXY(util.target.x + dx, util.target.y);
    }



}


module.exports = Scratch3DroneBlocks;
